-- advance_repayments has no location_id of its own (like purchase_items / stock_count_items), so it was
-- missed by the generic per-location RLS loop in the original constraints migration. Scope it through its
-- parent employee_advances row, the same way those other child tables are scoped through theirs.
ALTER TABLE advance_repayments ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_scope ON advance_repayments
  USING (EXISTS (SELECT 1 FROM employee_advances a WHERE a.id = advance_id))
  WITH CHECK (EXISTS (SELECT 1 FROM employee_advances a WHERE a.id = advance_id));
