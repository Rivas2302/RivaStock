-- 0007_quote_number_unique.sql
-- Add UNIQUE constraint on (user_id, number) and a server-side function
-- to generate the next quote number atomically.

ALTER TABLE quotes
  ADD CONSTRAINT quotes_user_number_unique UNIQUE (user_id, number);

CREATE OR REPLACE FUNCTION next_quote_number(p_user uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_next int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF v_uid <> p_user THEN RAISE EXCEPTION 'No autorizado'; END IF;

  SELECT COALESCE(
    MAX(NULLIF(regexp_replace(number, '\D', '', 'g'), '')::int),
    0
  ) + 1
    INTO v_next
    FROM quotes
   WHERE user_id = p_user;

  RETURN 'PRES-' || LPAD(v_next::text, 4, '0');
END;
$$;
