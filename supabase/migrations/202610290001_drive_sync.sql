begin;

-- Existing knowledge_chunks and its vector(384) column are preserved.
create table if not exists public.knowledge_sync_files (
  file_id text primary key,
  source_name text not null,
  modified_time text not null,
  pipeline_version text not null,
  chunk_ids text[] not null,
  synced_at timestamptz not null default now()
);
alter table public.knowledge_sync_files enable row level security;
revoke all on public.knowledge_sync_files from public, anon, authenticated;
grant select, insert, update on public.knowledge_sync_files to service_role;

create or replace function public.replace_drive_knowledge(
  p_file_id text,
  p_modified_time text,
  p_source_name text,
  p_pipeline_version text,
  p_chunks jsonb
) returns boolean
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  previous public.knowledge_sync_files%rowtype;
  ids text[];
  expected_prefix text;
  legacy_prefix text;
  chunk jsonb;
begin
  if coalesce(length(p_file_id), 0) = 0 or coalesce(length(p_source_name), 0) = 0
     or coalesce(length(p_pipeline_version), 0) = 0
     or p_modified_time is null or p_modified_time::timestamptz is null then
    raise exception 'Invalid document metadata';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'Chunks must be an array';
  end if;
  if jsonb_array_length(p_chunks) < 1 or jsonb_array_length(p_chunks) > 400 then
    raise exception 'Invalid chunk count';
  end if;

  -- Serialize replacement of a single document, including concurrent cron runs.
  perform pg_advisory_xact_lock(hashtextextended('drive-sync:' || p_file_id, 0));
  select * into previous from public.knowledge_sync_files where file_id = p_file_id;
  if found then
    if previous.modified_time::timestamptz > p_modified_time::timestamptz then
      return false; -- Never overwrite a newer Drive revision with an older one.
    end if;
    if previous.modified_time = p_modified_time
       and previous.source_name = p_source_name
       and previous.pipeline_version = p_pipeline_version then
      return false;
    end if;
  end if;

  expected_prefix := 'drive_' || encode(sha256(convert_to(p_file_id, 'UTF8')), 'hex') || '_';
  for chunk in select value from jsonb_array_elements(p_chunks) loop
    if coalesce(left(chunk->>'chunk_id', length(expected_prefix)), '') <> expected_prefix
       or coalesce(chunk->>'source', '') <> p_source_name
       or coalesce(length(chunk->>'topic'), 0) = 0
       or coalesce(length(chunk->>'content'), 0) = 0 then
      raise exception 'Invalid chunk metadata';
    end if;
    if jsonb_typeof(chunk->'embedding') is distinct from 'array' then
      raise exception 'Missing embedding';
    end if;
    if jsonb_array_length(chunk->'embedding') <> 384 then
      raise exception 'Invalid embedding dimensions';
    end if;
  end loop;
  select array_agg(value->>'chunk_id') into ids from jsonb_array_elements(p_chunks);
  if cardinality(ids) <> (select count(distinct id) from unnest(ids) as id) then
    raise exception 'Duplicate chunk IDs';
  end if;

  delete from public.knowledge_chunks where chunk_id = any(coalesce(previous.chunk_ids, array[]::text[]));
  -- Migrate this source's legacy hash-vectors only. Literal prefix comparison
  -- avoids SQL LIKE's '_' wildcard and leaves other sources untouched.
  legacy_prefix := 'auto_' || left(p_file_id, 8) || '_';
  delete from public.knowledge_chunks
    where left(chunk_id, length(legacy_prefix)) = legacy_prefix
      and source in (p_source_name, previous.source_name);

  insert into public.knowledge_chunks (chunk_id, source, topic, content, embedding)
    select value->>'chunk_id', value->>'source', value->>'topic', value->>'content',
      (value->'embedding')::text::vector(384)
    from jsonb_array_elements(p_chunks);

  insert into public.knowledge_sync_files (file_id, source_name, modified_time, pipeline_version, chunk_ids)
    values (p_file_id, p_source_name, p_modified_time, p_pipeline_version, ids)
    on conflict (file_id) do update set
      source_name = excluded.source_name, modified_time = excluded.modified_time,
      pipeline_version = excluded.pipeline_version, chunk_ids = excluded.chunk_ids, synced_at = now();
  return true;
end;
$$;
revoke all on function public.replace_drive_knowledge(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_drive_knowledge(text, text, text, text, jsonb) to service_role;

commit;
