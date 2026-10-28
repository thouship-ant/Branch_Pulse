-- Every user has a password (role-based default or one the Super Admin / an Admin set) and must change it after the first
-- sign-in. Admins still sign in with password + OTP; everyone else with OTP only.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
