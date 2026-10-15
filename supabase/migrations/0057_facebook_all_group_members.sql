BEGIN;
ALTER TABLE facebook_group_sync ADD COLUMN member_targets jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE facebook_group_sync ADD COLUMN member_cursor integer NOT NULL DEFAULT 0;
ALTER FUNCTION facebook_group_discovery(text,text,uuid,jsonb) RENAME TO facebook_group_discovery_before_all_members;
REVOKE ALL ON FUNCTION facebook_group_discovery_before_all_members(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION facebook_group_discovery(p_token text,p_operation text,p_request uuid DEFAULT NULL,p_data jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb; v_device facebook_devices; v_sync facebook_group_sync; v_targets jsonb; v_batch jsonb; v_cursor integer; v_total integer;
BEGIN
  IF p_operation='claim' THEN
    PERFORM facebook_worker(p_token,'heartbeat');
    SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
      WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
    SELECT * INTO v_sync FROM facebook_group_sync WHERE user_id=v_device.user_id AND device_id=v_device.id FOR UPDATE;
    IF FOUND AND v_sync.status='running' AND v_sync.member_cursor<jsonb_array_length(v_sync.member_targets) AND v_sync.requested_at>now()-interval '5 minutes' THEN
      RETURN jsonb_build_object('id',v_sync.id,'resumeMembers',true,'offset',v_sync.member_cursor,'total',jsonb_array_length(v_sync.member_targets),'member_targets',v_sync.member_targets);
    END IF;
  END IF;
  IF p_operation='members_batch' THEN
    PERFORM facebook_worker(p_token,'heartbeat');
    SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
      WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
    SELECT * INTO v_sync FROM facebook_group_sync WHERE user_id=v_device.user_id AND device_id=v_device.id FOR UPDATE;
    IF NOT FOUND OR v_sync.id IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Lectura no asignada a esta PC'; END IF;
    v_cursor:=(p_data->>'offset')::integer;v_total:=jsonb_array_length(v_sync.member_targets);
    IF v_cursor<v_sync.member_cursor THEN
      RETURN jsonb_build_object('offset',v_sync.member_cursor,'total',v_total,'member_targets',v_sync.member_targets);
    END IF;
    IF v_sync.status<>'running' OR v_cursor IS DISTINCT FROM v_sync.member_cursor OR v_cursor>=v_total THEN RAISE EXCEPTION 'Tanda de miembros fuera de orden'; END IF;
    v_batch:=p_data->'memberCounts';
    IF jsonb_typeof(v_batch) IS DISTINCT FROM 'array' OR jsonb_array_length(v_batch)<>least(3,v_total-v_cursor) THEN RAISE EXCEPTION 'Tanda de miembros incompleta'; END IF;
    FOR v_cursor IN v_sync.member_cursor..least(v_sync.member_cursor+2,v_total-1) LOOP
      IF facebook_group_key(v_batch->(v_cursor-v_sync.member_cursor)->>'url') IS DISTINCT FROM v_sync.member_targets->>v_cursor THEN RAISE EXCEPTION 'El grupo no corresponde a la tanda asignada'; END IF;
    END LOOP;
    -- Reuse the validated count writer; its result transition is replaced below
    -- within the same transaction, so readers never observe an interim done.
    v_result:=facebook_group_discovery_before_all_members(p_token,'result',p_request,jsonb_build_object('groups','[]'::jsonb,'memberCounts',v_batch,'partial',true));
    v_cursor:=v_sync.member_cursor+jsonb_array_length(v_batch);
    UPDATE facebook_group_sync SET member_cursor=v_cursor,status=CASE WHEN v_cursor=v_total THEN 'done' ELSE 'running' END,
      requested_at=clock_timestamp(),finished_at=CASE WHEN v_cursor=v_total THEN clock_timestamp() ELSE NULL END,
      message='Miembros consultados: '||v_cursor||' de '||v_total||'. Las cantidades no visibles se conservan como no disponibles.'
      WHERE user_id=v_device.user_id;
    RETURN jsonb_build_object('offset',v_cursor,'total',v_total,'member_targets',v_sync.member_targets);
  END IF;
  v_result:=facebook_group_discovery_before_all_members(p_token,p_operation,p_request,p_data);
  IF p_operation='result' AND p_data->>'readAllMembers'='true' AND v_result IS NOT NULL THEN
    SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
      WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
    SELECT coalesce(jsonb_agg(url ORDER BY url),'[]'::jsonb) INTO v_targets FROM (
      SELECT DISTINCT facebook_group_key(url) AS url FROM facebook_groups WHERE user_id=v_device.user_id
    ) g;
    v_total:=jsonb_array_length(v_targets);
    UPDATE facebook_group_sync SET member_targets=v_targets,member_cursor=0,
      status=CASE WHEN v_total=0 THEN 'done' ELSE 'running' END,requested_at=clock_timestamp(),
      finished_at=CASE WHEN v_total=0 THEN clock_timestamp() ELSE NULL END,
      message='Miembros consultados: 0 de '||v_total||'. La PC continuará automáticamente.'
      WHERE user_id=v_device.user_id AND id=p_request;
    RETURN jsonb_build_object('offset',0,'total',v_total,'member_targets',v_targets);
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION facebook_group_discovery(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_group_discovery(text,text,uuid,jsonb) TO anon,authenticated;
COMMIT;
