-- A recipe's ingredient list is replaced (delete + recreate) whenever the owner edits it, same as a stock count's lines.
GRANT DELETE ON recipe_items TO app_rw;
