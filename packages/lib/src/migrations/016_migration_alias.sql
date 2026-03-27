-- Handle migration renaming: 002_sort_order.sql → 014_sort_order.sql
-- If an existing deployment already applied 002_sort_order.sql, record the
-- new name so the migration runner doesn't try to re-apply it.
INSERT INTO _migrations (name, applied_at)
SELECT '014_sort_order.sql', applied_at
FROM _migrations
WHERE name = '002_sort_order.sql'
ON CONFLICT DO NOTHING;
