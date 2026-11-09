alter table public.catalog_config
  add column if not exists category_photos_enabled boolean not null default true,
  add column if not exists category_photo_overrides jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.catalog_config'::regclass
      and conname = 'catalog_config_category_photo_overrides_object_check'
  ) then
    alter table public.catalog_config
      add constraint catalog_config_category_photo_overrides_object_check
      check (jsonb_typeof(category_photo_overrides) = 'object');
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'orders'
    ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;
