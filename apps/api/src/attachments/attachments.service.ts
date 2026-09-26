import { Injectable } from '@nestjs/common';
import { IsInt, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AppException, notFound, validation } from '../common/app-exception';
import { ReqCtx } from '../common/auth-user';
import { PrismaService, Tx } from '../common/prisma.service';
import { env } from '../config/env';

const MAX_BYTES = 5 * 1024 * 1024; // V27
const URL_TTL_SECONDS = 300; // pre-signed URLs live 5 minutes (HLD s8)
const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

export class PresignDto {
  @IsString() @MaxLength(200) fileName: string;
  @IsString() mimeType: string;
  @IsInt() @Min(1) sizeBytes: number;
  @IsUUID() locationId: string;
}

/** Verify the file content really is the type it claims (jpeg/png/webp/pdf magic bytes). */
function sniffMatches(mime: string, b: Buffer): boolean {
  switch (mime) {
    case 'image/jpeg': return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png': return b.length > 4 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case 'image/webp': return b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
    case 'application/pdf': return b.subarray(0, 5).toString() === '%PDF-';
    default: return false;
  }
}

/**
 * Attachment storage (HLD P3). Dev implementation writes to local disk behind HMAC-signed, 5-minute
 * URLs; the signed-URL contract is what an S3/GCS/R2 provider would replace. The virus-scan hook
 * belongs in `upload()` before the file is made available.
 */
@Injectable()
export class AttachmentsService {
  private readonly root = path.resolve(env.uploadDir);

  constructor(private readonly prisma: PrismaService) {}

  private sign(method: string, key: string, exp: number) {
    return createHmac('sha256', env.jwtSecret).update(`${method}|${key}|${exp}`).digest('hex');
  }

  private verify(method: string, key: string, exp: number, sig: string) {
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
      throw new AppException(403, 'URL_EXPIRED', 'This link has expired');
    }
    const expected = Buffer.from(this.sign(method, key, exp));
    const given = Buffer.from(sig ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new AppException(403, 'URL_INVALID', 'Invalid link');
    }
  }

  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw validation('INVALID_FILE', 'Bad storage key');
    return p;
  }

  /** Issue a short-lived upload URL for a private object; nothing is ever public. */
  async presign(ctx: ReqCtx, dto: PresignDto) {
    if (!EXT[dto.mimeType]) throw validation('INVALID_FILE', 'Only JPEG, PNG, WebP or PDF files are allowed', 'mimeType');
    if (dto.sizeBytes > MAX_BYTES) throw validation('INVALID_FILE', 'File is larger than 5 MB', 'sizeBytes');

    const key = `tmp/${ctx.user.id}/${randomUUID()}${EXT[dto.mimeType]}`;
    await fs.mkdir(path.dirname(this.file(key)), { recursive: true });
    await fs.writeFile(
      this.file(`${key}.meta.json`),
      JSON.stringify({ mimeType: dto.mimeType, fileName: dto.fileName, locationId: dto.locationId, userId: ctx.user.id }),
    );
    const exp = Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
    const sig = this.sign('PUT', key, exp);
    return {
      key,
      method: 'PUT',
      uploadUrl: `/api/v1/attachments/local-upload?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`,
      headers: { 'Content-Type': dto.mimeType },
      expiresIn: URL_TTL_SECONDS,
    };
  }

  /** Receive the bytes for a presigned key (no bearer token: the signature is the credential). */
  async upload(key: string, exp: number, sig: string, contentType: string, body: Buffer) {
    this.verify('PUT', key, exp, sig);
    if (!Buffer.isBuffer(body) || body.length === 0) throw validation('INVALID_FILE', 'Empty upload');
    if (body.length > MAX_BYTES) throw validation('INVALID_FILE', 'File is larger than 5 MB');
    const meta = JSON.parse(await fs.readFile(this.file(`${key}.meta.json`), 'utf8').catch(() => 'null'));
    if (!meta) throw notFound('Upload slot');
    if (contentType?.split(';')[0] !== meta.mimeType || !sniffMatches(meta.mimeType, body)) {
      throw validation('INVALID_FILE', 'File content does not match its type');
    }
    // hook: antivirus scan of `body` goes here
    await fs.writeFile(this.file(key), body);
    await fs.writeFile(this.file(`${key}.meta.json`), JSON.stringify({ ...meta, sizeBytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }));
    return { ok: true, sizeBytes: body.length };
  }

  /**
   * Bind uploaded temp keys to a saved record (same transaction as the record). A key can only be
   * claimed by the user it was issued to and only for the location it was issued for.
   */
  async register(tx: Tx, ctx: ReqCtx, p: { entityType: string; entityId: string; locationId: string; keys: string[] }) {
    for (const key of p.keys) {
      if (!key.startsWith(`tmp/${ctx.user.id}/`)) throw validation('INVALID_FILE', 'Unknown attachment key', 'attachmentKeys');
      const raw = await fs.readFile(this.file(`${key}.meta.json`), 'utf8').catch(() => null);
      const meta = raw ? JSON.parse(raw) : null;
      if (!meta || !meta.sizeBytes) throw validation('INVALID_FILE', 'Attachment was not uploaded', 'attachmentKeys');
      if (meta.locationId !== p.locationId) throw validation('INVALID_FILE', 'Attachment belongs to another location', 'attachmentKeys');
      await tx.attachment.create({
        data: {
          entity_type: p.entityType,
          entity_id: p.entityId,
          location_id: p.locationId,
          storage_key: key,
          file_name: meta.fileName,
          mime_type: meta.mimeType,
          size_bytes: meta.sizeBytes,
          sha256: meta.sha256,
          created_by: ctx.user.id,
        },
      });
    }
  }

  list(ctx: ReqCtx, entityType: string, entityId: string) {
    return this.prisma.runScoped(ctx.user, (tx) =>
      tx.attachment.findMany({
        where: { entity_type: entityType, entity_id: entityId, status: 'ACTIVE' },
        select: { id: true, file_name: true, mime_type: true, size_bytes: true, created_at: true },
      }),
    );
  }

  /** Signed download URL; RLS ensures the caller can only resolve attachments of their own locations. */
  async downloadUrl(ctx: ReqCtx, id: string) {
    const a = await this.prisma.runScoped(ctx.user, (tx) => tx.attachment.findUnique({ where: { id } }));
    if (!a || a.status !== 'ACTIVE') throw notFound('Attachment');
    const exp = Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
    return {
      url: `/api/v1/attachments/local-download?key=${encodeURIComponent(a.storage_key)}&exp=${exp}&sig=${this.sign('GET', a.storage_key, exp)}`,
      expiresIn: URL_TTL_SECONDS,
    };
  }

  async resolveDownload(key: string, exp: number, sig: string) {
    this.verify('GET', key, exp, sig);
    const meta = JSON.parse(await fs.readFile(this.file(`${key}.meta.json`), 'utf8').catch(() => 'null'));
    if (!meta) throw notFound('File');
    return { path: this.file(key), mimeType: meta.mimeType as string, fileName: meta.fileName as string };
  }
}
