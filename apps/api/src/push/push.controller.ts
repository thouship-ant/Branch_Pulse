import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Ctx, ReqCtx } from '../common/auth-user';
import { PushService, RegisterDeviceDto, UnregisterDeviceDto } from './push.service';

/** A signed-in phone tells the server where to send its notifications. */
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('register') @HttpCode(200)
  register(@Ctx() ctx: ReqCtx, @Body() dto: RegisterDeviceDto) {
    return this.push.register(ctx, dto);
  }

  @Post('unregister') @HttpCode(200)
  unregister(@Ctx() ctx: ReqCtx, @Body() dto: UnregisterDeviceDto) {
    return this.push.unregister(ctx, dto.token);
  }

  @Post('test') @HttpCode(200)
  test(@Ctx() ctx: ReqCtx) {
    return this.push.sendTest(ctx);
  }
}
