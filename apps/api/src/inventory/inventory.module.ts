import { Module } from '@nestjs/common';
import { ItemsController, ReconciliationController, TransfersController, WastageController } from './inventory.controller';
import { ItemsService } from './items.service';
import { LedgerService } from './ledger.service';
import { ReconciliationService } from './reconciliation.service';
import { TransfersService } from './transfers.service';
import { WastageService } from './wastage.service';

@Module({
  controllers: [ItemsController, ReconciliationController, WastageController, TransfersController],
  providers: [LedgerService, ItemsService, ReconciliationService, WastageService, TransfersService],
  exports: [LedgerService, WastageService],
})
export class InventoryModule {}
