-- Why a stock count was sent back for re-counting, and why a wastage entry was rejected.
ALTER TABLE stock_counts ADD COLUMN review_comment text;
ALTER TABLE wastage ADD COLUMN rejection_reason text;
