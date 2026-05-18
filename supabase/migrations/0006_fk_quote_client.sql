-- 0006_fk_quote_client.sql
-- Convert quotes.client_id from text to uuid with proper FK.

-- 1. Nullify invalid values (empty string or non-uuid format)
UPDATE quotes
   SET client_id = NULL
 WHERE client_id = ''
    OR client_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 2. Change column type
ALTER TABLE quotes
  ALTER COLUMN client_id TYPE uuid USING NULLIF(client_id, '')::uuid;
ALTER TABLE quotes
  ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE quotes
  ADD CONSTRAINT quotes_client_fk
  FOREIGN KEY (client_id) REFERENCES customers(id) ON DELETE SET NULL;
