-- The Super Admin signs in with the number 5432167890 instead of the username "superadmin".
-- Fresh databases have no Super Admin yet (the seed creates it under the new name), so this only renames an existing one.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE mobile = '5432167890' OR (username = '5432167890' AND company_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'A company user already uses 5432167890; cannot rename the Super Admin';
  END IF;
  UPDATE users SET username = '5432167890'
   WHERE username = 'superadmin' AND company_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.username = '5432167890');
END $$;
