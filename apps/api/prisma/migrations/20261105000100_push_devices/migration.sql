-- Phones that receive push notifications (Expo push tokens), one row per device token.
CREATE TABLE "push_devices" (
  "id"           UUID         NOT NULL,
  "company_id"   UUID         DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
  "user_id"      UUID         NOT NULL,
  "token"        VARCHAR(200) NOT NULL,
  "platform"     VARCHAR(10),
  "device_name"  VARCHAR(100),
  "status"       VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE',
  "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "last_seen_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_devices_status_chk" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
);
CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");
CREATE INDEX "push_devices_user_id_idx" ON "push_devices"("user_id");

ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_company ON push_devices USING (app_company_ok(company_id)) WITH CHECK (app_company_ok(company_id));

GRANT SELECT, INSERT, UPDATE ON push_devices TO app_rw;
