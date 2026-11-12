-- Outside-shop orders (business meetings, functions, parties ...) with their payments.
CREATE SEQUENCE seq_code_order;

CREATE TABLE "orders" (
  "id"             UUID          NOT NULL,
  "company_id"     UUID          DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
  "code"           VARCHAR(30)   NOT NULL,
  "location_id"    UUID          NOT NULL,
  "customer_name"  VARCHAR(100)  NOT NULL,
  "customer_phone" VARCHAR(15),
  "event_type"     VARCHAR(20)   NOT NULL,
  "event_date"     DATE          NOT NULL,
  "event_time"     VARCHAR(5),
  "venue"          TEXT,
  "items_summary"  TEXT,
  "people_count"   INTEGER,
  "amount"         DECIMAL(14,2) NOT NULL,
  "paid_amount"    DECIMAL(14,2) NOT NULL DEFAULT 0,
  "payment_status" VARCHAR(10)   NOT NULL DEFAULT 'UNPAID',
  "status"         VARCHAR(12)   NOT NULL DEFAULT 'PLANNED',
  "notes"          TEXT,
  "entered_by"     UUID          NOT NULL,
  "created_at"     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "created_by"     UUID,
  "updated_at"     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updated_by"     UUID,
  "version"        INTEGER       NOT NULL DEFAULT 1,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_amount_chk" CHECK ("amount" > 0 AND "paid_amount" >= 0),
  CONSTRAINT "orders_payment_status_chk" CHECK ("payment_status" IN ('UNPAID', 'PARTIAL', 'PAID')),
  CONSTRAINT "orders_status_chk" CHECK ("status" IN ('PLANNED', 'DELIVERED', 'CANCELLED'))
);
CREATE UNIQUE INDEX "orders_code_key" ON "orders"("code");
CREATE INDEX "orders_location_id_event_date_idx" ON "orders"("location_id", "event_date");
CREATE INDEX "orders_payment_status_idx" ON "orders"("payment_status", "status");

CREATE TABLE "order_payments" (
  "id"         UUID          NOT NULL,
  "order_id"   UUID          NOT NULL,
  "paid_on"    DATE          NOT NULL,
  "amount"     DECIMAL(14,2) NOT NULL,
  "mode"       payment_mode  NOT NULL,
  "reference"  VARCHAR(60),
  "created_by" UUID,
  "created_at" TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_payments_amount_chk" CHECK ("amount" > 0)
);
CREATE INDEX "order_payments_order_id_idx" ON "order_payments"("order_id");

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_scope ON orders USING (app_scope_ok(location_id)) WITH CHECK (app_scope_ok(location_id));
ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_scope ON order_payments
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id)) WITH CHECK (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id));

GRANT SELECT, INSERT, UPDATE ON orders, order_payments TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE seq_code_order TO app_rw;

-- permissions: order:view / order:manage, given to the roles that run branches and money
INSERT INTO permissions (id, code, module, description) VALUES
  (gen_random_uuid(), 'order:view', 'order', 'See outside-shop orders'),
  (gen_random_uuid(), 'order:manage', 'order', 'Create and update outside-shop orders and record their payments')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON (
     (r.code IN ('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER') AND p.code IN ('order:view', 'order:manage'))
  OR (r.code = 'STOCK_MANAGER' AND p.code = 'order:view'))
ON CONFLICT DO NOTHING;
