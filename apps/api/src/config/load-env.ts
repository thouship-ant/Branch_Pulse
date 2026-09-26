// Load .env before anything reads process.env (Node >= 20.12). Missing file is fine (containers set real env).
try {
  (process as any).loadEnvFile?.('.env');
} catch {
  /* no .env file */
}
