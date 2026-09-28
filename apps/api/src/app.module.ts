import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { JwtAuthGuard, LocationScopeGuard, PermissionsGuard } from './common/guards';
import { ResponseInterceptor } from './common/response';
import { DailyModule } from './daily/daily.module';
import { EmployeesModule } from './employees/employees.module';
import { ExpensesModule } from './expenses/expenses.module';
import { HealthController } from './health.controller';
import { InsightsModule } from './insights/insights.module';
import { InventoryModule } from './inventory/inventory.module';
import { PurchasesModule } from './purchases/purchases.module';
import { RecipesModule } from './recipes/recipes.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ScheduleModule.forRoot(),
    CommonModule,
    AttachmentsModule,
    AuthModule,
    AdminModule,
    DailyModule,
    EmployeesModule,
    ExpensesModule,
    InsightsModule,
    InventoryModule,
    PurchasesModule,
    RecipesModule,
    SyncModule,
  ],
  controllers: [HealthController],
  providers: [
    // order matters: rate limit -> authenticate -> permission (what) -> location scope (where)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: LocationScopeGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
