-- The lines of a draft stock count are working papers: while the count is IN_PROGRESS the manager re-saves them, which replaces the lines.
-- (Submitted and approved counts are never touched: the service refuses to edit them.)
GRANT DELETE ON stock_count_items TO app_rw;
