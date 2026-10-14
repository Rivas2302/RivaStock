BEGIN;

CREATE TABLE supplier_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  supplier_name text NOT NULL CHECK (length(btrim(supplier_name)) BETWEEN 1 AND 160),
  ordered_on date NOT NULL DEFAULT current_date,
  reference text NOT NULL DEFAULT '' CHECK (length(reference) <= 160),
  tracking_number text CHECK (tracking_number ~ '^[0-9]{12}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'transit', 'ready', 'received', 'cancelled')),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  document_path text,
  document_name text,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (document_path IS NULL OR document_path LIKE user_id::text || '/' || id::text || '/%.pdf'),
  CHECK ((document_path IS NULL) = (document_name IS NULL))
);
CREATE INDEX supplier_orders_account_date ON supplier_orders(user_id, ordered_on DESC);
CREATE UNIQUE INDEX supplier_orders_unique_guide ON supplier_orders(user_id, tracking_number) WHERE tracking_number IS NOT NULL;
ALTER TABLE supplier_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_orders_read ON supplier_orders FOR SELECT TO authenticated
  USING (user_id = get_owner_uid(auth.uid()) AND has_permission(auth.uid(), 'proveedores', 'read'));
CREATE POLICY supplier_orders_insert ON supplier_orders FOR INSERT TO authenticated
  WITH CHECK (user_id = get_owner_uid(auth.uid()) AND has_permission(auth.uid(), 'proveedores', 'write'));
CREATE POLICY supplier_orders_update ON supplier_orders FOR UPDATE TO authenticated
  USING (user_id = get_owner_uid(auth.uid()) AND has_permission(auth.uid(), 'proveedores', 'write'))
  WITH CHECK (user_id = get_owner_uid(auth.uid()) AND has_permission(auth.uid(), 'proveedores', 'write'));
GRANT SELECT, INSERT, UPDATE ON supplier_orders TO authenticated;

CREATE FUNCTION stamp_supplier_order() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  IF TG_OP = 'UPDATE' THEN
    NEW.id := OLD.id;
    NEW.user_id := OLD.user_id;
    NEW.created_at := OLD.created_at;
  END IF;
  IF NEW.status = 'received' THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'received' THEN
      NEW.received_at := OLD.received_at;
    ELSE
      NEW.received_at := now();
    END IF;
  ELSE
    NEW.received_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER supplier_orders_stamp BEFORE INSERT OR UPDATE ON supplier_orders
  FOR EACH ROW EXECUTE FUNCTION stamp_supplier_order();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('supplier-order-documents', 'supplier-order-documents', false, 10485760, ARRAY['application/pdf']);
CREATE POLICY supplier_order_documents_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'supplier-order-documents'
    AND (storage.foldername(name))[1] = get_owner_uid(auth.uid())::text
    AND has_permission(auth.uid(), 'proveedores', 'read'));
CREATE POLICY supplier_order_documents_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'supplier-order-documents'
    AND (storage.foldername(name))[1] = get_owner_uid(auth.uid())::text
    AND has_permission(auth.uid(), 'proveedores', 'write'));
CREATE POLICY supplier_order_documents_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'supplier-order-documents'
    AND (storage.foldername(name))[1] = get_owner_uid(auth.uid())::text
    AND has_permission(auth.uid(), 'proveedores', 'write')
    AND has_permission(auth.uid(), 'proveedores', 'read')
    AND NOT EXISTS (SELECT 1 FROM public.supplier_orders o WHERE o.document_path = name));

COMMIT;
