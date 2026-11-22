import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/auth-user';
import { companyScope, PrismaService } from '../common/prisma.service';

/** A company's app background picture ("frame"). Public on purpose: a CSS background cannot send a token, and it is only a picture. */
@Controller('branding')
export class BrandingController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get(':companyId/frame')
  async frame(@Param('companyId', ParseUUIDPipe) companyId: string, @Res() res: Response) {
    const row = await this.prisma.runScoped(companyScope(companyId), (tx) =>
      tx.setting.findUnique({ where: { company_id_key: { company_id: companyId, key: 'business.frame' } }, select: { value: true } }),
    );
    const m = typeof row?.value === 'string' ? /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(row.value) : null;
    if (!m) throw new NotFoundException();
    res.set({ 'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    res.send(Buffer.from(m[2], 'base64'));
  }
}
