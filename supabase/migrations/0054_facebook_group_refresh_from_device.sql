BEGIN;
-- This capability can request a read-only group refresh for its own account.
-- It neither approves products nor activates the publication queue.
CREATE FUNCTION request_facebook_groups_from_device(p_token text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_device facebook_devices; v_request facebook_group_sync;
BEGIN
  PERFORM facebook_worker(p_token,'heartbeat');
  SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
    WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF v_device.id IS NULL OR NOT has_permission(v_device.user_id,'stock','write') THEN RAISE EXCEPTION 'Sin permiso para actualizar grupos'; END IF;
  INSERT INTO facebook_group_sync(user_id,device_id,status) VALUES(v_device.user_id,v_device.id,'requested')
    ON CONFLICT(user_id) DO UPDATE SET id=gen_random_uuid(),device_id=excluded.device_id,status='requested',requested_at=clock_timestamp(),finished_at=NULL,message=NULL
    WHERE facebook_group_sync.status<>'running' OR facebook_group_sync.requested_at<now()-interval '5 minutes';
  SELECT * INTO v_request FROM facebook_group_sync WHERE user_id=v_device.user_id;
  IF v_request.device_id<>v_device.id THEN RAISE EXCEPTION 'Otra PC está leyendo los grupos. Esperá a que termine o revisá el pedido en RivaStock.'; END IF;
  RETURN v_request.id;
END;
$$;
REVOKE ALL ON FUNCTION request_facebook_groups_from_device(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION request_facebook_groups_from_device(text) TO anon,authenticated;
COMMIT;
