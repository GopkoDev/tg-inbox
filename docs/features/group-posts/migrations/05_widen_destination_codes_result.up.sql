-- destination_codes.result may also say a group needs the send-messages right ('no_send_right') and that the
-- 20-destination limit stopped the connect ('destination_limit') (follow-up T26).
ALTER TABLE destination_codes DROP CONSTRAINT destination_codes_result_check;
ALTER TABLE destination_codes ADD CONSTRAINT destination_codes_result_check CHECK (
  (result IS NULL) = (result_at IS NULL)
  AND (result IS NULL OR result IN ('connected', 'no_post_right', 'no_send_right', 'destination_limit'))
  AND COALESCE(result = 'connected', false) = (used_at IS NOT NULL)
);
