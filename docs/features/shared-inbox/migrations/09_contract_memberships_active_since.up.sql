-- Contract (3/3): every membership has an active-since time. Apply only after the code that sets it on
-- join and on reactivation is deployed (02 backfilled the existing rows).
ALTER TABLE memberships ALTER COLUMN active_since SET NOT NULL;
