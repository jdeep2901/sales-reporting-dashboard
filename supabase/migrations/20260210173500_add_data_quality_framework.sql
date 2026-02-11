alter table public.dashboard_versions
  add column if not exists qa_status text,
  add column if not exists qa_score numeric,
  add column if not exists qa_summary jsonb,
  add column if not exists qa_report jsonb,
  add column if not exists qa_run_at timestamptz;

create or replace function public.get_dashboard_state(p_username text, p_password text)
returns table (
  users jsonb,
  likelihood jsonb,
  quarter_targets jsonb,
  settings jsonb,
  dataset jsonb,
  active_version_id uuid,
  latest_version_id uuid,
  versions_meta jsonb,
  updated_at timestamptz,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  st public.dashboard_state%rowtype;
  u jsonb;
  v_username text;
  v_salt text;
  v_hash text;
  v_role text;
  v_versions_meta jsonb;
begin
  v_username := public._norm_user(p_username);
  if v_username = '' then
    raise exception 'INVALID_CREDENTIALS';
  end if;

  select * into st
  from public.dashboard_state
  where id = 'main'
  for update;

  if st.id is null then
    insert into public.dashboard_state (id)
    values ('main')
    returning * into st;
  end if;

  if st.users = '{}'::jsonb then
    v_salt := encode(extensions.gen_random_bytes(16), 'hex');
    v_hash := public._hash_pass(v_salt, p_password);
    st.users := jsonb_build_object(
      v_username,
      jsonb_build_object(
        'username', v_username,
        'role', 'admin',
        'salt', v_salt,
        'password_hash', v_hash,
        'created_at', now(),
        'created_by', 'bootstrap',
        'updated_at', now(),
        'last_login_at', now()
      )
    );

    update public.dashboard_state
    set users = st.users,
        updated_at = now()
    where id = 'main'
    returning * into st;
  else
    u := st.users -> v_username;
    if u is null then
      raise exception 'INVALID_CREDENTIALS';
    end if;

    v_salt := coalesce(u ->> 'salt', '');
    v_hash := public._hash_pass(v_salt, p_password);
    if v_hash <> coalesce(u ->> 'password_hash', '') then
      raise exception 'INVALID_CREDENTIALS';
    end if;

    v_role := coalesce(u ->> 'role', 'viewer');
    st.users := jsonb_set(st.users, array[v_username, 'last_login_at'], to_jsonb(now()), true);
    st.users := jsonb_set(st.users, array[v_username, 'updated_at'], to_jsonb(now()), true);
    update public.dashboard_state
    set users = st.users,
        updated_at = now()
    where id = 'main'
    returning * into st;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'created_at', v.created_at,
        'created_by', v.created_by,
        'board_id', v.board_id,
        'board_name', v.board_name,
        'item_count', v.item_count,
        'source', v.source,
        'notes', v.notes,
        'qa_status', v.qa_status,
        'qa_score', v.qa_score,
        'qa_run_at', v.qa_run_at
      )
      order by v.created_at desc
    ),
    '[]'::jsonb
  ) into v_versions_meta
  from public.dashboard_versions v;

  users := st.users;
  likelihood := st.likelihood;
  quarter_targets := st.quarter_targets;
  settings := st.settings;
  dataset := st.dataset;
  active_version_id := st.active_version_id;
  latest_version_id := st.latest_version_id;
  versions_meta := v_versions_meta;
  updated_at := st.updated_at;
  role := coalesce(v_role, 'admin');
  return next;
end;
$$;

create or replace function public.save_dashboard_state(
  p_username text,
  p_password text,
  p_likelihood jsonb default null,
  p_quarter_targets jsonb default null,
  p_users jsonb default null,
  p_settings jsonb default null,
  p_dataset jsonb default null,
  p_active_version_id uuid default null
)
returns table (
  users jsonb,
  likelihood jsonb,
  quarter_targets jsonb,
  settings jsonb,
  dataset jsonb,
  active_version_id uuid,
  latest_version_id uuid,
  versions_meta jsonb,
  updated_at timestamptz,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  st public.dashboard_state%rowtype;
  v_role text;
  v_versions_meta jsonb;
begin
  v_role := public._auth_dashboard_role(p_username, p_password);

  if p_users is not null and v_role <> 'admin' then
    raise exception 'FORBIDDEN_USERS_UPDATE';
  end if;
  if p_settings is not null and v_role <> 'admin' then
    raise exception 'FORBIDDEN_SETTINGS_UPDATE';
  end if;
  if p_dataset is not null and v_role <> 'admin' then
    raise exception 'FORBIDDEN_DATASET_UPDATE';
  end if;
  if p_active_version_id is not null and v_role <> 'admin' then
    raise exception 'FORBIDDEN_ACTIVE_VERSION_UPDATE';
  end if;
  if p_active_version_id is not null and not exists (
    select 1 from public.dashboard_versions v where v.id = p_active_version_id
  ) then
    raise exception 'INVALID_ACTIVE_VERSION_ID';
  end if;

  update public.dashboard_state as d
  set likelihood = coalesce(p_likelihood, d.likelihood),
      quarter_targets = coalesce(p_quarter_targets, d.quarter_targets),
      users = coalesce(p_users, d.users),
      settings = coalesce(p_settings, d.settings),
      dataset = coalesce(p_dataset, d.dataset),
      active_version_id = coalesce(p_active_version_id, d.active_version_id),
      dataset_refreshed_at = case when p_dataset is not null then now() else d.dataset_refreshed_at end,
      updated_at = now()
  where d.id = 'main'
  returning * into st;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'created_at', v.created_at,
        'created_by', v.created_by,
        'board_id', v.board_id,
        'board_name', v.board_name,
        'item_count', v.item_count,
        'source', v.source,
        'notes', v.notes,
        'qa_status', v.qa_status,
        'qa_score', v.qa_score,
        'qa_run_at', v.qa_run_at
      )
      order by v.created_at desc
    ),
    '[]'::jsonb
  ) into v_versions_meta
  from public.dashboard_versions v;

  users := st.users;
  likelihood := st.likelihood;
  quarter_targets := st.quarter_targets;
  settings := st.settings;
  dataset := st.dataset;
  active_version_id := st.active_version_id;
  latest_version_id := st.latest_version_id;
  versions_meta := v_versions_meta;
  updated_at := st.updated_at;
  role := v_role;
  return next;
end;
$$;

create or replace function public.get_dashboard_version_qa(
  p_username text,
  p_password text,
  p_version_id uuid
)
returns table (
  version_id uuid,
  qa_status text,
  qa_score numeric,
  qa_summary jsonb,
  qa_report jsonb,
  qa_run_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public._auth_dashboard_role(p_username, p_password);
  if p_version_id is null then
    raise exception 'VERSION_ID_REQUIRED';
  end if;

  return query
  select v.id, v.qa_status, v.qa_score, coalesce(v.qa_summary, '{}'::jsonb), coalesce(v.qa_report, '{}'::jsonb), v.qa_run_at
  from public.dashboard_versions v
  where v.id = p_version_id;

  if not found then
    raise exception 'VERSION_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.get_dashboard_version_qa(text, text, uuid) from public;
grant execute on function public.get_dashboard_version_qa(text, text, uuid) to anon, authenticated;
