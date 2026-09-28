import { Module } from '@nestjs/common';
import { ItemsController, ReconciliationController, TransfersController, UnitsController, WastageController } from './inventory.controller';
import { ItemsService } from './items.service';
import { LedgerService } from './ledger.service';
import { ReconciliationService } from './reconciliation.service';
import { TransfersService } from './transfers.service';
import { UnitsService } from './units.service';
import { WastageService } from './wastage.service';

@Module({
  controllers: [ItemsController, ReconciliationController, WastageController, TransfersController, UnitsController],
  providers: [LedgerService, ItemsService, ReconciliationService, WastageService, TransfersService, UnitsService],
  exports: [LedgerService, WastageService],
})
export class InventoryModule {}
