import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationsController, MasterController, UsersController } from './admin.controller';
import { LocationsService } from './locations.service';
import { MasterService } from './master.service';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [LocationsController, UsersController, MasterController],
  providers: [LocationsService, UsersService, MasterService],
  exports: [LocationsService],
})
export class AdminModule {}
