-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "record_status" AS ENUM ('ACTIVE', 'INACTIVE', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "location_type" AS ENUM ('BRANCH', 'GODOWN', 'CENTRAL_OFFICE');

-- CreateEnum
CREATE TYPE "approval_status" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_mode" AS ENUM ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT');

-- CreateEnum
CREATE TYPE "entry_source" AS ENUM ('WEB', 'PWA_OFFLINE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "closing_status" AS ENUM ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REOPENED');

-- CreateEnum
CREATE TYPE "cash_txn_type" AS ENUM ('OPENING', 'OTHER_RECEIPT', 'WITHDRAWAL', 'DEPOSIT_TO_BANK', 'EXPENSE', 'PURCHASE', 'SUPPLIER_PAYMENT', 'ADVANCE_PAYMENT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY', 'WEEK_OFF', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "stock_txn_type" AS ENUM ('OPENING', 'PURCHASE_IN', 'TRANSFER_OUT', 'TRANSFER_IN', 'CONSUMPTION', 'WASTAGE', 'COUNT_ADJUSTMENT', 'TRANSFER_VARIANCE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "transfer_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'PARTIALLY_RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "count_status" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "wastage_reason" AS ENUM ('SPOILED', 'EXPIRED', 'BURNT', 'DAMAGED', 'EXCESS_PREPARATION', 'STAFF_CONSUMPTION', 'COMPLIMENTARY', 'OTHER');

-- CreateEnum
CREATE TYPE "advance_status" AS ENUM ('REQUESTED', 'MANAGER_APPROVED', 'APPROVED', 'REJECTED', 'PAID', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "alert_severity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "scope_mode" VARCHAR(10) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "module" VARCHAR(30) NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "mobile" VARCHAR(15),
    "email" VARCHAR(120),
    "full_name" VARCHAR(100) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "preferred_language" CHAR(2) NOT NULL DEFAULT 'en',
    "employee_id" UUID,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_logins" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "user_locations" (
    "user_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,

    CONSTRAINT "user_locations_pkey" PRIMARY KEY ("user_id","location_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "device_label" VARCHAR(100),
    "user_agent" TEXT,
    "ip" INET,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_limits" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "max_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "approval_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "location_type" NOT NULL,
    "address" TEXT,
    "phone" VARCHAR(15),
    "manager_user_id" UUID,
    "default_opening_cash" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "card_enabled" BOOLEAN NOT NULL DEFAULT true,
    "opened_on" DATE,
    "monthly_rent" DECIMAL(14,2),
    "notes" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "name_en" VARCHAR(60) NOT NULL,
    "name_ta" VARCHAR(60),
    "pl_bucket" VARCHAR(20) NOT NULL,
    "requires_receipt_above" DECIMAL(14,2),
    "unusual_threshold" DECIMAL(14,2),
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "base_unit_id" UUID,
    "factor_to_base" DECIMAL(14,6) NOT NULL DEFAULT 1,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name_en" VARCHAR(80) NOT NULL,
    "name_ta" VARCHAR(80),
    "category" VARCHAR(30) NOT NULL,
    "base_unit_id" UUID NOT NULL,
    "purchase_unit_id" UUID,
    "is_perishable" BOOLEAN NOT NULL DEFAULT false,
    "daily_count_required" BOOLEAN NOT NULL DEFAULT false,
    "variance_threshold_pct" DECIMAL(7,3),
    "variance_threshold_qty" DECIMAL(14,3),
    "last_purchase_rate" DECIMAL(14,4),
    "avg_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_location_settings" (
    "item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "min_stock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reorder_qty" DECIMAL(14,3),
    "is_stocked" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "item_location_settings_pkey" PRIMARY KEY ("item_id","location_id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "contact_person" VARCHAR(60),
    "phone" VARCHAR(15),
    "address" TEXT,
    "gstin" VARCHAR(15),
    "payment_terms_days" SMALLINT NOT NULL DEFAULT 0,
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "opening_balance_date" DATE,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_items" (
    "supplier_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,

    CONSTRAINT "supplier_items_pkey" PRIMARY KEY ("supplier_id","item_id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "daily_sales" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "total_sales" DECIMAL(14,2) NOT NULL,
    "cash_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "upi_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "card_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "complimentary_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_adjustments" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "mismatch_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "client_uuid" UUID,
    "client_created_at" TIMESTAMPTZ,
    "source" "entry_source" NOT NULL DEFAULT 'WEB',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "daily_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "txn_type" "cash_txn_type" NOT NULL,
    "direction" SMALLINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "source_type" VARCHAR(30),
    "source_id" UUID,
    "description" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "reversal_of_id" UUID,
    "client_uuid" UUID,
    "source" "entry_source" NOT NULL DEFAULT 'WEB',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_reconciliation" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "opening_cash" DECIMAL(14,2) NOT NULL,
    "cash_sales" DECIMAL(14,2) NOT NULL,
    "other_receipts" DECIMAL(14,2) NOT NULL,
    "cash_expenses" DECIMAL(14,2) NOT NULL,
    "cash_purchases" DECIMAL(14,2) NOT NULL,
    "other_cash_out" DECIMAL(14,2) NOT NULL,
    "withdrawals" DECIMAL(14,2) NOT NULL,
    "expected_closing" DECIMAL(14,2) NOT NULL,
    "actual_closing" DECIMAL(14,2),
    "variance" DECIMAL(14,2),
    "denomination_json" JSONB,
    "variance_reason" VARCHAR(40),
    "manager_explanation" TEXT,
    "variance_approval" "approval_status",
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cash_reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_closing" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "status" "closing_status" NOT NULL DEFAULT 'PENDING',
    "daily_sales_id" UUID,
    "cash_reconciliation_id" UUID,
    "total_sales" DECIMAL(14,2),
    "cash_sales" DECIMAL(14,2),
    "upi_sales" DECIMAL(14,2),
    "card_sales" DECIMAL(14,2),
    "total_expenses" DECIMAL(14,2),
    "total_purchases" DECIMAL(14,2),
    "total_wastage_value" DECIMAL(14,2),
    "expected_cash" DECIMAL(14,2),
    "actual_cash" DECIMAL(14,2),
    "cash_variance" DECIMAL(14,2),
    "stock_notes" TEXT,
    "remarks" TEXT,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "review_comment" TEXT,
    "reopen_count" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "daily_closing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_closing_events" (
    "id" UUID NOT NULL,
    "daily_closing_id" UUID NOT NULL,
    "from_status" "closing_status",
    "to_status" "closing_status" NOT NULL,
    "actor_id" UUID NOT NULL,
    "comment" TEXT,
    "snapshot" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_closing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "status" "attendance_status" NOT NULL,
    "overtime_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "check_in" TIME,
    "check_out" TIME,
    "remarks" TEXT,
    "marked_by" UUID NOT NULL,
    "client_uuid" UUID,
    "source" "entry_source" NOT NULL DEFAULT 'WEB',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "category_id" UUID NOT NULL,
    "sub_category_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_mode" "payment_mode" NOT NULL,
    "supplier_id" UUID,
    "payee_name" VARCHAR(100),
    "description" TEXT,
    "period_from" DATE,
    "period_to" DATE,
    "employee_id" UUID,
    "approval_status" "approval_status" NOT NULL DEFAULT 'SUBMITTED',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "entered_by" UUID NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "reversal_of_id" UUID,
    "client_uuid" UUID,
    "client_created_at" TIMESTAMPTZ,
    "source" "entry_source" NOT NULL DEFAULT 'WEB',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_ref_no" VARCHAR(40),
    "subtotal" DECIMAL(14,2) NOT NULL,
    "other_charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "payment_mode" "payment_mode" NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "due_date" DATE,
    "remarks" TEXT,
    "approval_status" "approval_status" NOT NULL DEFAULT 'SUBMITTED',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "entered_by" UUID NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "reversal_of_id" UUID,
    "client_uuid" UUID,
    "client_created_at" TIMESTAMPTZ,
    "source" "entry_source" NOT NULL DEFAULT 'WEB',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_id" UUID NOT NULL,
    "base_quantity" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,4) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "supplier_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_mode" "payment_mode" NOT NULL,
    "reference_no" VARCHAR(40),
    "purchase_id" UUID,
    "remarks" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "reversal_of_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_ledger" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "entry_type" VARCHAR(20) NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "source_type" VARCHAR(30),
    "source_id" UUID,
    "due_date" DATE,
    "location_id" UUID,
    "narration" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "supplier_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "txn_type" "stock_txn_type" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "balance_after" DECIMAL(14,3) NOT NULL,
    "source_type" VARCHAR(30) NOT NULL,
    "source_id" UUID NOT NULL,
    "counterparty_location_id" UUID,
    "reversal_of_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "location_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "in_transit_in" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avg_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "last_txn_at" TIMESTAMPTZ,
    "last_counted_on" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("location_id","item_id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "from_location_id" UUID NOT NULL,
    "to_location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "status" "transfer_status" NOT NULL DEFAULT 'DRAFT',
    "requested_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "dispatched_by" UUID,
    "dispatched_at" TIMESTAMPTZ,
    "received_by" UUID,
    "received_at" TIMESTAMPTZ,
    "vehicle_ref" VARCHAR(40),
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_items" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "sent_qty" DECIMAL(14,3) NOT NULL,
    "received_qty" DECIMAL(14,3),
    "unit_cost" DECIMAL(14,4),
    "variance_reason" VARCHAR(40),

    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "count_type" VARCHAR(10) NOT NULL,
    "status" "count_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "counted_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "remarks" TEXT,
    "client_uuid" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_items" (
    "id" UUID NOT NULL,
    "stock_count_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "expected_qty" DECIMAL(14,3) NOT NULL,
    "physical_qty" DECIMAL(14,3) NOT NULL,
    "variance_qty" DECIMAL(14,3) NOT NULL,
    "variance_value" DECIMAL(14,2),
    "is_significant" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(40),
    "explanation" TEXT,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wastage" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_id" UUID NOT NULL,
    "base_quantity" DECIMAL(14,3) NOT NULL,
    "estimated_value" DECIMAL(14,2) NOT NULL,
    "reason" "wastage_reason" NOT NULL,
    "reason_note" TEXT,
    "entered_by" UUID NOT NULL,
    "approval_status" "approval_status" NOT NULL DEFAULT 'SUBMITTED',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "client_uuid" UUID,
    "client_created_at" TIMESTAMPTZ,
    "source" "entry_source" NOT NULL DEFAULT 'WEB',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "wastage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name_en" VARCHAR(80) NOT NULL,
    "name_ta" VARCHAR(80),
    "yield_qty" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "selling_price" DECIMAL(14,2),
    "effective_from" DATE NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_items" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_id" UUID NOT NULL,
    "base_quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_cost_snapshots" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "cost_per_unit" DECIMAL(14,4) NOT NULL,
    "selling_price" DECIMAL(14,2),
    "gross_margin_pct" DECIMAL(7,3),
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "recipe_cost_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "location_id" UUID NOT NULL,
    "job_role" VARCHAR(40) NOT NULL,
    "phone" VARCHAR(15),
    "joining_date" DATE NOT NULL,
    "exit_date" DATE,
    "salary_type" VARCHAR(10) NOT NULL,
    "base_salary" DECIMAL(14,2) NOT NULL,
    "overtime_rate_per_hour" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_method" VARCHAR(10),
    "bank_details_enc" BYTEA,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "period_month" DATE NOT NULL,
    "working_days" DECIMAL(5,2) NOT NULL,
    "present_days" DECIMAL(5,2) NOT NULL,
    "leave_days" DECIMAL(5,2) NOT NULL,
    "overtime_hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "basic_earned" DECIMAL(14,2) NOT NULL,
    "overtime_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "allowances" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advance_recovery" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_status" VARCHAR(10) NOT NULL DEFAULT 'UNPAID',
    "approval_status" "approval_status" NOT NULL DEFAULT 'DRAFT',
    "approved_by" UUID,
    "paid_on" DATE,
    "payment_mode" "payment_mode",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "salary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_advances" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "employee_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "request_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "monthly_recovery" DECIMAL(14,2),
    "status" "advance_status" NOT NULL DEFAULT 'REQUESTED',
    "requested_by" UUID NOT NULL,
    "manager_approved_by" UUID,
    "manager_approved_at" TIMESTAMPTZ,
    "final_approved_by" UUID,
    "final_approved_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_on" DATE,
    "payment_mode" "payment_mode",
    "recovered_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remaining_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employee_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_repayments" (
    "id" UUID NOT NULL,
    "advance_id" UUID NOT NULL,
    "salary_id" UUID,
    "repaid_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "advance_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profit_loss" (
    "location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "total_sales" DECIMAL(14,2) NOT NULL,
    "raw_material_cost" DECIMAL(14,2) NOT NULL,
    "salary" DECIMAL(14,2) NOT NULL,
    "rent" DECIMAL(14,2) NOT NULL,
    "electricity" DECIMAL(14,2) NOT NULL,
    "transport" DECIMAL(14,2) NOT NULL,
    "maintenance" DECIMAL(14,2) NOT NULL,
    "other_expenses" DECIMAL(14,2) NOT NULL,
    "wastage" DECIMAL(14,2) NOT NULL,
    "operating_profit" DECIMAL(14,2) NOT NULL,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "computed_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "profit_loss_pkey" PRIMARY KEY ("location_id","business_date")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" VARCHAR(200),
    "mime_type" VARCHAR(60) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "params" JSONB NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "channels" JSONB NOT NULL DEFAULT '["IN_APP"]',
    "updated_at" TIMESTAMPTZ,
    "updated_by" UUID,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "rule_code" VARCHAR(40) NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "location_id" UUID,
    "business_date" DATE,
    "title" VARCHAR(160) NOT NULL,
    "message" TEXT,
    "metric_value" DECIMAL(14,3),
    "entity_type" VARCHAR(30),
    "entity_id" UUID,
    "dedupe_key" VARCHAR(160) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMPTZ,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" VARCHAR(12) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "sent_at" TIMESTAMPTZ,
    "read_at" TIMESTAMPTZ,
    "error" TEXT,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "actor_role" VARCHAR(30),
    "location_id" UUID,
    "action" VARCHAR(20) NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" UUID,
    "entity_code" VARCHAR(40),
    "old_values" JSONB,
    "new_values" JSONB,
    "changed_fields" TEXT[],
    "reason" TEXT,
    "request_id" UUID,
    "ip" INET,
    "user_agent" TEXT,
    "device_id" VARCHAR(64),
    "source" "entry_source",

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operations" (
    "client_uuid" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" UUID,
    "result" VARCHAR(12) NOT NULL,
    "response" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("client_uuid")
);

-- CreateTable
CREATE TABLE "report_exports" (
    "id" UUID NOT NULL,
    "report_code" VARCHAR(40) NOT NULL,
    "format" VARCHAR(5) NOT NULL,
    "params" JSONB NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "storage_key" TEXT,
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "error" TEXT,

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_key" ON "users"("mobile");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_limits_role_id_entity_type_key" ON "approval_limits"("role_id", "entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_parent_id_name_en_key" ON "expense_categories"("parent_id", "name_en");

-- CreateIndex
CREATE UNIQUE INDEX "units_code_key" ON "units"("code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_code_key" ON "inventory_items"("code");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "daily_sales_client_uuid_key" ON "daily_sales"("client_uuid");

-- CreateIndex
CREATE INDEX "daily_sales_location_id_business_date_idx" ON "daily_sales"("location_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_client_uuid_key" ON "cash_transactions"("client_uuid");

-- CreateIndex
CREATE INDEX "cash_transactions_location_id_business_date_idx" ON "cash_transactions"("location_id", "business_date");

-- CreateIndex
CREATE INDEX "cash_transactions_source_type_source_id_idx" ON "cash_transactions"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_reconciliation_location_id_business_date_key" ON "cash_reconciliation"("location_id", "business_date");

-- CreateIndex
CREATE INDEX "daily_closing_status_business_date_idx" ON "daily_closing"("status", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closing_location_id_business_date_key" ON "daily_closing"("location_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_client_uuid_key" ON "attendance"("client_uuid");

-- CreateIndex
CREATE INDEX "attendance_location_id_business_date_idx" ON "attendance"("location_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_employee_id_business_date_key" ON "attendance"("employee_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_code_key" ON "expenses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_client_uuid_key" ON "expenses"("client_uuid");

-- CreateIndex
CREATE INDEX "expenses_location_id_business_date_idx" ON "expenses"("location_id", "business_date");

-- CreateIndex
CREATE INDEX "expenses_category_id_business_date_idx" ON "expenses"("category_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_code_key" ON "purchases"("code");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_client_uuid_key" ON "purchases"("client_uuid");

-- CreateIndex
CREATE INDEX "purchases_location_id_business_date_idx" ON "purchases"("location_id", "business_date");

-- CreateIndex
CREATE INDEX "purchases_supplier_id_due_date_idx" ON "purchases"("supplier_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_items_purchase_id_line_no_key" ON "purchase_items"("purchase_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_code_key" ON "supplier_payments"("code");

-- CreateIndex
CREATE INDEX "supplier_ledger_supplier_id_entry_date_idx" ON "supplier_ledger"("supplier_id", "entry_date");

-- CreateIndex
CREATE INDEX "inventory_transactions_location_id_item_id_business_date_idx" ON "inventory_transactions"("location_id", "item_id", "business_date");

-- CreateIndex
CREATE INDEX "inventory_transactions_source_type_source_id_idx" ON "inventory_transactions"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_code_key" ON "stock_transfers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_items_transfer_id_item_id_key" ON "stock_transfer_items"("transfer_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_client_uuid_key" ON "stock_counts"("client_uuid");

-- CreateIndex
CREATE INDEX "stock_counts_location_id_business_date_idx" ON "stock_counts"("location_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_items_stock_count_id_item_id_key" ON "stock_count_items"("stock_count_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "wastage_code_key" ON "wastage"("code");

-- CreateIndex
CREATE UNIQUE INDEX "wastage_client_uuid_key" ON "wastage"("client_uuid");

-- CreateIndex
CREATE INDEX "wastage_location_id_business_date_idx" ON "wastage"("location_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_code_key" ON "recipes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_items_recipe_id_item_id_key" ON "recipe_items"("recipe_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_cost_snapshots_recipe_id_snapshot_date_key" ON "recipe_cost_snapshots"("recipe_id", "snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "employees_code_key" ON "employees"("code");

-- CreateIndex
CREATE UNIQUE INDEX "salary_employee_id_period_month_key" ON "salary"("employee_id", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "employee_advances_code_key" ON "employee_advances"("code");

-- CreateIndex
CREATE INDEX "attachments_entity_type_entity_id_idx" ON "attachments"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "notifications_status_severity_created_at_idx" ON "notifications"("status", "severity", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_occurred_at_idx" ON "audit_logs"("entity_type", "entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_occurred_at_idx" ON "audit_logs"("actor_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closing_events" ADD CONSTRAINT "daily_closing_events_daily_closing_id_fkey" FOREIGN KEY ("daily_closing_id") REFERENCES "daily_closing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_repayments" ADD CONSTRAINT "advance_repayments_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "employee_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

