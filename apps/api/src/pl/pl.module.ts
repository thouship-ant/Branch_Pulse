import { Module } from '@nestjs/common';
import { PLController } from './pl.controller';
import { PLService } from './pl.service';

@Module({
  controllers: [PLController],
  providers: [PLService],
})
export class PLModule {}
