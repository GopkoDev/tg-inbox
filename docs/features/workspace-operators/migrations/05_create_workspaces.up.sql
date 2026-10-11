-- workspaces: one business and the tenancy boundary. No status column — no members yet = awaiting its first owner.
CREATE TABLE IF NOT EXISTS workspaces (
  id         uuid        NOT NULL,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT workspaces_pkey PRIMARY KEY (id),
  CONSTRAINT workspaces_name_length_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 200)
);
