ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_wrote_order_check;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_wrote_pair_check;
ALTER TABLE contacts
  DROP COLUMN IF EXISTS last_wrote_at,
  DROP COLUMN IF EXISTS first_wrote_at;
