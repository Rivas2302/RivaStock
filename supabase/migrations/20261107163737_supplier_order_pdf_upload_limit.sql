DO $$
BEGIN
  UPDATE storage.buckets
     SET file_size_limit = 52428800
   WHERE id = 'supplier-order-documents';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplier-order-documents bucket does not exist';
  END IF;
END;
$$;
