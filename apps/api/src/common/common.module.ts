import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CodesService } from './codes.service';
import { PrismaService } from './prisma.service';
import { RulesService } from './rules.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [PrismaService, AuditService, SettingsService, RulesService, CodesService],
  exports: [PrismaService, AuditService, SettingsService, RulesService, CodesService],
})
export class CommonModule {}
