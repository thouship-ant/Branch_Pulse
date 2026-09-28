import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationsController, MasterController, RolesController, UsersController } from './admin.controller';
import { BranchReportService } from './branch-report.service';
import { LocationsService } from './locations.service';
import { MasterService } from './master.service';
import { RolesService } from './roles.service';
import { TransliterationService } from './transliteration.service';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [LocationsController, UsersController, MasterController, RolesController],
  providers: [LocationsService, BranchReportService, TransliterationService, UsersService, MasterService, RolesService],
  exports: [LocationsService],
})
export class AdminModule {}
