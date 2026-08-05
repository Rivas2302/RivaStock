-- scripts/sql/0038_diagnostic.sql
-- Run each block separately in the SQL Editor and paste the output.

-- 1. What is the actual return type and body of save_product_with_holdings?
SELECT
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS return_type,
  p.prosecdef AS is_security_definer,
  length(p.prosrc) AS body_length
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'save_product_with_holdings',
    'save_product_with_holdings_unlocked'
  )
ORDER BY p.proname;

-- 2. Try the function directly with a minimal payload and see what comes back.
--    Replace the product id with a real one from your products table.
SELECT jsonb_typeof(save_product_with_holdings(
  jsonb_build_object(
    'id', (SELECT id FROM products LIMIT 1),
    'name', 'Test product',
    'categoryId', '',
    'category', 'Test',
    'salePrice', 100,
    'stock', 1,
    'minStock', 0,
    'purchasePrice', 0,
    'showInCatalog', false,
    'images', '[]'::jsonb,
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  '[{"inventoryOwnerId":"' || (SELECT id FROM inventory_owners WHERE is_primary LIMIT 1)::text || '","stock":1,"purchaseCost":0,"minStock":0,"active":true}]'::jsonb,
  'diag-test-' || extract(epoch from now())::text
)) AS response_type;

-- 3. Same call but returning the actual content (in case it is an object or array).
SELECT save_product_with_holdings(
  jsonb_build_object(
    'id', (SELECT id FROM products LIMIT 1),
    'name', 'Test product',
    'categoryId', '',
    'category', 'Test',
    'salePrice', 100,
    'stock', 1,
    'minStock', 0,
    'purchasePrice', 0,
    'showInCatalog', false,
    'images', '[]'::jsonb,
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  '[{"inventoryOwnerId":"' || (SELECT id FROM inventory_owners WHERE is_primary LIMIT 1)::text || '","stock":1,"purchaseCost":0,"minStock":0,"active":true}]'::jsonb,
  'diag-test-2-' || extract(epoch from now())::text
) AS response;

-- 4. Current settings for your account.
SELECT
  user_id,
  holdings_enabled
FROM inventory_operation_settings;
