import { Module } from '@nestjs/common';
import { BackdateController } from './backdate.controller';
import { BackdateService } from './backdate.service';

@Module({ controllers: [BackdateController], providers: [BackdateService] })
export class BackdateModule {}
