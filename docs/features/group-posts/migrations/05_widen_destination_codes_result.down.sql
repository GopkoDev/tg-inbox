UPDATE destination_codes SET result = 'no_post_right' WHERE result = 'no_send_right';
UPDATE destination_codes SET result = NULL, result_at = NULL WHERE result = 'destination_limit';
ALTER TABLE destination_codes DROP CONSTRAINT destination_codes_result_check;
ALTER TABLE destination_codes ADD CONSTRAINT destination_codes_result_check CHECK (
  (result IS NULL) = (result_at IS NULL)
  AND (result IS NULL OR result IN ('connected', 'no_post_right'))
  AND COALESCE(result = 'connected', false) = (used_at IS NOT NULL)
);
