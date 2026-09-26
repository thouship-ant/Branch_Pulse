import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Ctx, Public, ReqCtx } from '../common/auth-user';
import { AttachmentsService, PresignDto } from './attachments.service';

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly svc: AttachmentsService) {}

  /** Any signed-in user may request an upload slot for a location they can access (scope guard + RLS). */
  @Post('presign')
  presign(@Ctx() ctx: ReqCtx, @Body() dto: PresignDto) {
    return this.svc.presign(ctx, dto);
  }

  // The signature in the query string is the credential for these two, so no bearer token is needed.
  @Public()
  @Put('local-upload')
  upload(@Query('key') key: string, @Query('exp') exp: string, @Query('sig') sig: string, @Req() req: Request) {
    return this.svc.upload(key, Number(exp), sig, req.headers['content-type'] ?? '', req.body as Buffer);
  }

  @Public()
  @Get('local-download')
  async download(@Query('key') key: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const f = await this.svc.resolveDownload(key, Number(exp), sig);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Content-Disposition', `inline; filename="${(f.fileName ?? 'file').replace(/[^\w.\-]/g, '_')}"`);
    res.sendFile(f.path);
  }

  @Get()
  list(@Ctx() ctx: ReqCtx, @Query('entityType') entityType: string, @Query('entityId', ParseUUIDPipe) entityId: string) {
    return this.svc.list(ctx, entityType, entityId);
  }

  @Get(':id/url')
  url(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.downloadUrl(ctx, id);
  }
}
