-- DropForeignKey
ALTER TABLE "advance_repayments" DROP CONSTRAINT "fk_advance_repayments_salary_id";

-- DropForeignKey
ALTER TABLE "approval_limits" DROP CONSTRAINT "fk_approval_limits_role_id";

-- DropForeignKey
ALTER TABLE "attachments" DROP CONSTRAINT "fk_attachments_created_by";

-- DropForeignKey
ALTER TABLE "attachments" DROP CONSTRAINT "fk_attachments_location_id";

-- DropForeignKey
ALTER TABLE "attendance" DROP CONSTRAINT "fk_attendance_employee_id";

-- DropForeignKey
ALTER TABLE "attendance" DROP CONSTRAINT "fk_attendance_location_id";

-- DropForeignKey
ALTER TABLE "attendance" DROP CONSTRAINT "fk_attendance_marked_by";

-- DropForeignKey
ALTER TABLE "cash_reconciliation" DROP CONSTRAINT "fk_cash_reconciliation_approved_by";

-- DropForeignKey
ALTER TABLE "cash_reconciliation" DROP CONSTRAINT "fk_cash_reconciliation_location_id";

-- DropForeignKey
ALTER TABLE "cash_transactions" DROP CONSTRAINT "fk_cash_transactions_location_id";

-- DropForeignKey
ALTER TABLE "cash_transactions" DROP CONSTRAINT "fk_cash_transactions_reversal_of_id";

-- DropForeignKey
ALTER TABLE "daily_closing" DROP CONSTRAINT "fk_daily_closing_cash_reconciliation_id";

-- DropForeignKey
ALTER TABLE "daily_closing" DROP CONSTRAINT "fk_daily_closing_daily_sales_id";

-- DropForeignKey
ALTER TABLE "daily_closing" DROP CONSTRAINT "fk_daily_closing_location_id";

-- DropForeignKey
ALTER TABLE "daily_closing" DROP CONSTRAINT "fk_daily_closing_reviewed_by";

-- DropForeignKey
ALTER TABLE "daily_closing" DROP CONSTRAINT "fk_daily_closing_submitted_by";

-- DropForeignKey
ALTER TABLE "daily_closing_events" DROP CONSTRAINT "fk_daily_closing_events_actor_id";

-- DropForeignKey
ALTER TABLE "daily_sales" DROP CONSTRAINT "fk_daily_sales_location_id";

-- DropForeignKey
ALTER TABLE "daily_sales" DROP CONSTRAINT "fk_daily_sales_submitted_by";

-- DropForeignKey
ALTER TABLE "employee_advances" DROP CONSTRAINT "fk_employee_advances_employee_id";

-- DropForeignKey
ALTER TABLE "employee_advances" DROP CONSTRAINT "fk_employee_advances_location_id";

-- DropForeignKey
ALTER TABLE "employee_advances" DROP CONSTRAINT "fk_employee_advances_requested_by";

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "fk_employees_location_id";

-- DropForeignKey
ALTER TABLE "expense_categories" DROP CONSTRAINT "fk_expense_categories_parent_id";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "fk_expenses_approved_by";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "fk_expenses_category_id";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "fk_expenses_employee_id";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "fk_expenses_entered_by";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "fk_expenses_location_id";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "fk_expenses_reversal_of_id";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "fk_expenses_sub_category_id";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "fk_expenses_supplier_id";

-- DropForeignKey
ALTER TABLE "inventory_items" DROP CONSTRAINT "fk_inventory_items_base_unit_id";

-- DropForeignKey
ALTER TABLE "inventory_items" DROP CONSTRAINT "fk_inventory_items_purchase_unit_id";

-- DropForeignKey
ALTER TABLE "inventory_transactions" DROP CONSTRAINT "fk_inventory_transactions_counterparty_location_id";

-- DropForeignKey
ALTER TABLE "inventory_transactions" DROP CONSTRAINT "fk_inventory_transactions_item_id";

-- DropForeignKey
ALTER TABLE "inventory_transactions" DROP CONSTRAINT "fk_inventory_transactions_location_id";

-- DropForeignKey
ALTER TABLE "inventory_transactions" DROP CONSTRAINT "fk_inventory_transactions_reversal_of_id";

-- DropForeignKey
ALTER TABLE "item_location_settings" DROP CONSTRAINT "fk_item_location_settings_item_id";

-- DropForeignKey
ALTER TABLE "item_location_settings" DROP CONSTRAINT "fk_item_location_settings_location_id";

-- DropForeignKey
ALTER TABLE "locations" DROP CONSTRAINT "fk_locations_manager_user_id";

-- DropForeignKey
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "fk_notification_deliveries_notification_id";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "fk_notifications_location_id";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "fk_notifications_rule_code";

-- DropForeignKey
ALTER TABLE "profit_loss" DROP CONSTRAINT "fk_profit_loss_location_id";

-- DropForeignKey
ALTER TABLE "purchase_items" DROP CONSTRAINT "fk_purchase_items_item_id";

-- DropForeignKey
ALTER TABLE "purchase_items" DROP CONSTRAINT "fk_purchase_items_unit_id";

-- DropForeignKey
ALTER TABLE "purchases" DROP CONSTRAINT "fk_purchases_approved_by";

-- DropForeignKey
ALTER TABLE "purchases" DROP CONSTRAINT "fk_purchases_entered_by";

-- DropForeignKey
ALTER TABLE "purchases" DROP CONSTRAINT "fk_purchases_location_id";

-- DropForeignKey
ALTER TABLE "purchases" DROP CONSTRAINT "fk_purchases_reversal_of_id";

-- DropForeignKey
ALTER TABLE "purchases" DROP CONSTRAINT "fk_purchases_supplier_id";

-- DropForeignKey
ALTER TABLE "recipe_cost_snapshots" DROP CONSTRAINT "fk_recipe_cost_snapshots_recipe_id";

-- DropForeignKey
ALTER TABLE "recipe_items" DROP CONSTRAINT "fk_recipe_items_item_id";

-- DropForeignKey
ALTER TABLE "recipe_items" DROP CONSTRAINT "fk_recipe_items_unit_id";

-- DropForeignKey
ALTER TABLE "salary" DROP CONSTRAINT "fk_salary_employee_id";

-- DropForeignKey
ALTER TABLE "salary" DROP CONSTRAINT "fk_salary_location_id";

-- DropForeignKey
ALTER TABLE "stock_balances" DROP CONSTRAINT "fk_stock_balances_item_id";

-- DropForeignKey
ALTER TABLE "stock_balances" DROP CONSTRAINT "fk_stock_balances_location_id";

-- DropForeignKey
ALTER TABLE "stock_count_items" DROP CONSTRAINT "fk_stock_count_items_item_id";

-- DropForeignKey
ALTER TABLE "stock_counts" DROP CONSTRAINT "fk_stock_counts_location_id";

-- DropForeignKey
ALTER TABLE "stock_transfer_items" DROP CONSTRAINT "fk_stock_transfer_items_item_id";

-- DropForeignKey
ALTER TABLE "stock_transfers" DROP CONSTRAINT "fk_stock_transfers_from_location_id";

-- DropForeignKey
ALTER TABLE "stock_transfers" DROP CONSTRAINT "fk_stock_transfers_requested_by";

-- DropForeignKey
ALTER TABLE "stock_transfers" DROP CONSTRAINT "fk_stock_transfers_to_location_id";

-- DropForeignKey
ALTER TABLE "supplier_items" DROP CONSTRAINT "fk_supplier_items_item_id";

-- DropForeignKey
ALTER TABLE "supplier_items" DROP CONSTRAINT "fk_supplier_items_supplier_id";

-- DropForeignKey
ALTER TABLE "supplier_ledger" DROP CONSTRAINT "fk_supplier_ledger_location_id";

-- DropForeignKey
ALTER TABLE "supplier_ledger" DROP CONSTRAINT "fk_supplier_ledger_supplier_id";

-- DropForeignKey
ALTER TABLE "supplier_payments" DROP CONSTRAINT "fk_supplier_payments_location_id";

-- DropForeignKey
ALTER TABLE "supplier_payments" DROP CONSTRAINT "fk_supplier_payments_purchase_id";

-- DropForeignKey
ALTER TABLE "supplier_payments" DROP CONSTRAINT "fk_supplier_payments_reversal_of_id";

-- DropForeignKey
ALTER TABLE "supplier_payments" DROP CONSTRAINT "fk_supplier_payments_supplier_id";

-- DropForeignKey
ALTER TABLE "units" DROP CONSTRAINT "fk_units_base_unit_id";

-- DropForeignKey
ALTER TABLE "user_locations" DROP CONSTRAINT "fk_user_locations_location_id";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "fk_users_employee_id";

-- DropForeignKey
ALTER TABLE "wastage" DROP CONSTRAINT "fk_wastage_approved_by";

-- DropForeignKey
ALTER TABLE "wastage" DROP CONSTRAINT "fk_wastage_entered_by";

-- DropForeignKey
ALTER TABLE "wastage" DROP CONSTRAINT "fk_wastage_item_id";

-- DropForeignKey
ALTER TABLE "wastage" DROP CONSTRAINT "fk_wastage_location_id";

-- DropForeignKey
ALTER TABLE "wastage" DROP CONSTRAINT "fk_wastage_unit_id";

-- DropIndex
DROP INDEX "ix_expenses_loc_date_incl";

-- AlterTable
ALTER TABLE "expense_categories" ADD COLUMN     "requires_supplier" BOOLEAN NOT NULL DEFAULT false;
