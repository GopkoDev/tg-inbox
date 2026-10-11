-- auth: one sign-in identity per normalised email, shared across workspaces.
CREATE TABLE IF NOT EXISTS accounts (
  id            uuid        NOT NULL,
  email         text        NOT NULL,
  display_name  text        NOT NULL,
  password_hash text        NOT NULL,
  created_at    timestamptz NOT NULL,
  CONSTRAINT accounts_pkey PRIMARY KEY (id),
  CONSTRAINT accounts_email_key UNIQUE (email),
  CONSTRAINT accounts_email_normalised_check CHECK (email = lower(btrim(email))),
  CONSTRAINT accounts_email_length_check CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT accounts_display_name_length_check CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 200)
);
