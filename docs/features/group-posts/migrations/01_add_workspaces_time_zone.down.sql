ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_time_zone_check;
ALTER TABLE workspaces DROP COLUMN IF EXISTS time_zone;
