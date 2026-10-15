BEGIN;
ALTER TABLE facebook_groups ADD COLUMN member_count_text text CHECK (member_count_text IS NULL OR length(member_count_text) BETWEEN 1 AND 80);
ALTER TABLE facebook_groups ADD COLUMN member_count_updated_at timestamptz;
ALTER TABLE facebook_groups ADD COLUMN member_count_checked_at timestamptz;
ALTER FUNCTION facebook_group_discovery(text,text,uuid,jsonb) RENAME TO facebook_group_discovery_before_members;
REVOKE ALL ON FUNCTION facebook_group_discovery_before_members(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION facebook_group_discovery(p_token text,p_operation text,p_request uuid DEFAULT NULL,p_data jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb; v_owner uuid; item jsonb; v_count text; v_url text;
BEGIN
  -- The existing function validates expiry/revocation, owner, request and lock.
  v_result:=facebook_group_discovery_before_members(p_token,p_operation,p_request,p_data);
  SELECT d.user_id INTO v_owner FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
    WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF p_operation='claim' AND v_result IS NOT NULL THEN
    RETURN v_result || jsonb_build_object('member_targets',(
      SELECT coalesce(jsonb_agg(g.url),'[]'::jsonb) FROM (
        SELECT url FROM facebook_groups WHERE user_id=v_owner
        ORDER BY member_count_checked_at NULLS FIRST,name,id LIMIT 3
      ) g));
  END IF;
  IF p_operation='result' AND v_result IS NOT NULL THEN
    IF p_data ? 'memberCounts' AND (jsonb_typeof(p_data->'memberCounts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'memberCounts')>3) THEN
      RAISE EXCEPTION 'Lectura de miembros inválida';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_data->'groups','[]'::jsonb))
      UNION ALL SELECT value FROM jsonb_array_elements(coalesce(p_data->'memberCounts','[]'::jsonb)) LOOP
      IF NOT (item ? 'memberCount') THEN CONTINUE; END IF;
      v_count:=btrim(item->>'memberCount'); v_url:=facebook_group_key(item->>'url');
      IF v_count IS NOT NULL AND (length(v_count)>80 OR v_count !~* '^[0-9][0-9.,]*( *([mM]|mil|millones))?( +de)? +(miembros|members)$') THEN
        RAISE EXCEPTION 'Cantidad de miembros inválida';
      END IF;
      -- Missing data never erases a previously observed count. Timestamp still
      -- rotates checked groups so unavailable headers cannot starve the rest.
      UPDATE facebook_groups SET member_count_text=coalesce(v_count,member_count_text),
        member_count_updated_at=CASE WHEN v_count IS NOT NULL THEN now() ELSE member_count_updated_at END,member_count_checked_at=now()
        WHERE user_id=v_owner AND facebook_group_key(url)=v_url;
    END LOOP;
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION facebook_group_discovery(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_group_discovery(text,text,uuid,jsonb) TO anon,authenticated;
COMMIT;
