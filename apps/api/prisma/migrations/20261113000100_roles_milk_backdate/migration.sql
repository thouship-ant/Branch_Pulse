-- 1. Role names: the branch role is called "Branch Admin"; the Staff role is no longer a default (a company's Admin can create one).
UPDATE roles SET name = 'Branch Admin' WHERE code = 'BRANCH_MANAGER' AND name = 'Branch Manager';
UPDATE roles SET status = 'INACTIVE'
 WHERE code = 'STAFF' AND is_system AND status = 'ACTIVE'
   AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.role_id = roles.id);

-- 2. "Buffalo milk" sub-category becomes "Packet milk"
UPDATE expense_categories SET name_en = 'Packet milk', name_ta = 'பாக்கெட் பால்' WHERE name_en = 'Buffalo milk';

-- 3. Requests to enter a previous day that was not closed on time
CREATE TABLE "backdate_requests" (
  "id"            UUID         NOT NULL,
  "company_id"    UUID         DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
  "location_id"   UUID         NOT NULL,
  "business_date" DATE         NOT NULL,
  "requested_by"  UUID         NOT NULL,
  "reason"        TEXT         NOT NULL,
  "status"        VARCHAR(10)  NOT NULL DEFAULT 'PENDING',
  "decided_by"    UUID,
  "decided_at"    TIMESTAMPTZ,
  "decision_note" TEXT,
  "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "backdate_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "backdate_requests_status_chk" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'))
);
CREATE INDEX "backdate_requests_location_id_business_date_idx" ON "backdate_requests"("location_id", "business_date");
CREATE INDEX "backdate_requests_status_idx" ON "backdate_requests"("status");

ALTER TABLE backdate_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_scope ON backdate_requests USING (app_scope_ok(location_id)) WITH CHECK (app_scope_ok(location_id));
GRANT SELECT, INSERT, UPDATE ON backdate_requests TO app_rw;
