// e2e tests never touch the dev database: they run against branch_pulse_test.
// Create it once (see README "Testing"): migrations + `db:seed` against these URLs.
const base = process.env.TEST_DB_BASE || 'postgresql://%USER%:%PASS%@localhost:5432/branch_pulse_test?schema=public';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || base.replace('%USER%', 'app_rw').replace('%PASS%', 'app_rw');
process.env.DIRECT_URL = process.env.TEST_DIRECT_URL || base.replace('%USER%', 'postgres').replace('%PASS%', 'postgres');
process.env.NODE_ENV = 'test';
process.env.LOGIN_RATE_LIMIT = '1000'; // the suite logs in far more than 10x/min; production keeps 10/min/IP
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.OTP_FIXED_CODE = '123456'; // every OTP is this code; no SMS is sent
process.env.OTP_RESEND_SECONDS = '0'; // the suite asks for OTPs back to back
