-- ===== end of data: point the imported rows at production's own permission / unit ids, drop the helpers =====
DO $fix$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name, CASE WHEN c.column_name = 'permission_id' THEN 'permissions' ELSE 'units' END AS kind
    FROM information_schema.columns c
    JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.table_name NOT IN ('units', 'permissions')
      AND (c.column_name = 'permission_id' OR c.column_name LIKE '%unit\_id')
  LOOP
    IF r.kind = 'permissions' THEN
      EXECUTE format('UPDATE public.%I t SET %I = p.id FROM pg_temp.bp_idmap m JOIN public.permissions p ON p.code = m.code WHERE m.kind = %L AND t.%I = m.dev_id', r.table_name, r.column_name, r.kind, r.column_name);
    ELSE
      EXECUTE format('UPDATE public.%I t SET %I = u.id FROM pg_temp.bp_idmap m JOIN public.units u ON u.code = m.code WHERE m.kind = %L AND t.%I = m.dev_id', r.table_name, r.column_name, r.kind, r.column_name);
    END IF;
  END LOOP;
END $fix$;

DROP TRIGGER bp_fix_user_keys ON public.users;
DROP FUNCTION public.bp_fix_user_keys();
