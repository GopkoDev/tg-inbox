-- Backfill (2/3): an existing membership became active when it was created. A membership reactivated before
-- this step gets its creation time (under-estimates the floor; pre-pilot data only — see the audit report).
UPDATE memberships SET active_since = created_at WHERE active_since IS NULL;
