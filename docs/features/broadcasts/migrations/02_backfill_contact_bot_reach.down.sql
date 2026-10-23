-- No-op: the backfilled rows leave with the table when 01 is reverted. Reverting 02 alone keeps them, which is what
-- capture would have written for those contacts anyway.
SELECT 1;
