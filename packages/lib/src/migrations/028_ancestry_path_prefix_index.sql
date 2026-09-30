-- Migration 028: Index ancestry_path for subtree queries.
--
-- getDescendants and the CASCADE revocations in permission-service and
-- abac-service select a subtree by the prefix of ancestry_path. text_pattern_ops
-- lets a btree index serve a prefix LIKE whatever the database collation is.
-- Without this index, every subtree query scans the whole tenants table.
CREATE INDEX IF NOT EXISTS idx_tenant_ancestry_path_prefix
  ON tenants (ancestry_path text_pattern_ops);
