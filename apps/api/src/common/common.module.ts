import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CodesService } from './codes.service';
import { CryptoService } from './crypto.service';
import { PrismaService } from './prisma.service';
import { RulesService } from './rules.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [PrismaService, AuditService, SettingsService, RulesService, CodesService, CryptoService],
  exports: [PrismaService, AuditService, SettingsService, RulesService, CodesService, CryptoService],
})
export class CommonModule {}
