import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CodesService } from './codes.service';
import { CryptoService } from './crypto.service';
import { PrismaService } from './prisma.service';
import { RealtimeService } from './realtime.service';
import { RulesService } from './rules.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [PrismaService, AuditService, SettingsService, RulesService, CodesService, CryptoService, RealtimeService],
  exports: [PrismaService, AuditService, SettingsService, RulesService, CodesService, CryptoService, RealtimeService],
})
export class CommonModule {}
