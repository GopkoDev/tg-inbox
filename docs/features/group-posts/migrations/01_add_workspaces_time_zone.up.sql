-- workspaces.time_zone: the workspace time zone (group-posts ADR-0006), an IANA name such as 'Europe/Kyiv'.
-- Owned by workspaces; written only through workspaces.setTimeZone, called by the posts route.
-- NULL until the first business owner who schedules a post confirms it (spec Clarifications).
-- The database cannot tell a valid IANA name; packages/shared/src/time-zone.ts validates it. The check keeps only
-- the shape: no surrounding space, 1–64 characters. Adding a nullable column with no default rewrites nothing.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS time_zone text NULL
  CONSTRAINT workspaces_time_zone_check
  CHECK (time_zone IS NULL OR (char_length(time_zone) BETWEEN 1 AND 64 AND time_zone = btrim(time_zone)));
