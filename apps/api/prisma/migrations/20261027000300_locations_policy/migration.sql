-- A new location cannot be checked by looking itself up (the row does not exist yet while its INSERT is validated),
-- so the locations policy reads the row's own company_id and id instead of calling app_scope_ok().
DROP POLICY p_scope ON locations;
CREATE POLICY p_scope ON locations
  USING (
    app_is_super()
    OR (company_id = nullif(current_setting('app.company_id', true), '')::uuid
        AND (coalesce(current_setting('app.all_locations', true), '') = 'true'
             OR id = ANY (string_to_array(nullif(current_setting('app.allowed_locations', true), ''), ',')::uuid[])))
  )
  WITH CHECK (
    app_is_super()
    OR (company_id = nullif(current_setting('app.company_id', true), '')::uuid
        AND (coalesce(current_setting('app.all_locations', true), '') = 'true'
             OR id = ANY (string_to_array(nullif(current_setting('app.allowed_locations', true), ''), ',')::uuid[])))
  );
