import { Module } from '@nestjs/common';
import { PurchasesController, StockController, SuppliersController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { StockService } from './stock.service';
import { SupplierReportsService } from './supplier-reports.service';
import { SuppliersService } from './suppliers.service';

@Module({
  controllers: [PurchasesController, SuppliersController, StockController],
  providers: [PurchasesService, SuppliersService, SupplierReportsService, StockService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
