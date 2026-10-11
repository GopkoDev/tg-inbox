-- auth: failed sign-in log per normalised email. No FK — unknown emails are recorded the same way (AC-09).
CREATE TABLE IF NOT EXISTS sign_in_failures (
  id        uuid        NOT NULL,
  email     text        NOT NULL,
  failed_at timestamptz NOT NULL,
  CONSTRAINT sign_in_failures_pkey PRIMARY KEY (id),
  CONSTRAINT sign_in_failures_email_normalised_check CHECK (email = lower(btrim(email)))
);

-- Lockout window check and clearing by email (flows 1, 2, 12).
CREATE INDEX IF NOT EXISTS sign_in_failures_email_failed_at_idx ON sign_in_failures (email, failed_at);
