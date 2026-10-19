-- No-op: the backfilled values leave with the columns when 01 is reverted. Reverting 02 alone keeps them, which is
-- what capture would have written anyway.
SELECT 1;
