import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * AES-256-GCM at rest for fields that must never be stored in plain text (employee bank details).
 * Layout: iv (12B) + auth tag (16B) + ciphertext, all in one Buffer for a single Bytes column.
 */
@Injectable()
export class CryptoService {
  private readonly key = (() => {
    const k = Buffer.from(env.bankDetailsKey, 'hex');
    if (k.length !== 32) throw new Error('BANK_DETAILS_KEY must be 64 hex characters (32 bytes) for AES-256');
    return k;
  })();

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(blob: Buffer): string {
    const iv = blob.subarray(0, IV_LEN);
    const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = blob.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
