create or replace function public._dashboard_public_user(p_user jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'username', p_user ->> 'username',
    'role', coalesce(p_user ->> 'role', 'viewer'),
    'created_at', p_user -> 'created_at',
    'created_by', p_user -> 'created_by',
    'updated_at', p_user -> 'updated_at',
    'last_login_at', p_user -> 'last_login_at'
  ));
$$;

create or replace function public._public_dashboard_users(
  p_users jsonb,
  p_role text,
  p_username text
)
returns jsonb
language sql
stable
as $$
  with src as (
    select coalesce(p_users, '{}'::jsonb) as users,
           coalesce(p_role, 'viewer') as role,
           public._norm_user(p_username) as username
  ),
  filtered as (
    select
      key,
      public._dashboard_public_user(value) as user_value
    from src,
    lateral jsonb_each(src.users)
    where src.role = 'admin' or key = src.username
  )
  select coalesce(jsonb_object_agg(key, user_value), '{}'::jsonb)
  from filtered;
$$;

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
    v_role := 'admin';
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

  users := public._public_dashboard_users(st.users, v_role, v_username);
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
  v_username text;
begin
  v_username := public._norm_user(p_username);
  v_role := public._auth_dashboard_role(p_username, p_password);

  if p_users is not null then
    raise exception 'USER_UPDATES_REQUIRE_ADMIN_RPC';
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

  users := public._public_dashboard_users(st.users, v_role, v_username);
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

create or replace function public.upsert_dashboard_user(
  p_username text,
  p_password text,
  p_target_username text,
  p_target_password text,
  p_target_role text default 'viewer'
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
  v_actor text;
  v_target text;
  v_target_role text;
  v_now timestamptz := now();
  v_salt text;
  v_hash text;
  v_existing jsonb;
begin
  v_actor := public._norm_user(p_username);
  v_target := public._norm_user(p_target_username);
  v_role := public._auth_dashboard_role(p_username, p_password);
  if v_role <> 'admin' then
    raise exception 'FORBIDDEN';
  end if;
  if v_target = '' then
    raise exception 'TARGET_USERNAME_REQUIRED';
  end if;
  if coalesce(length(p_target_password), 0) < 6 then
    raise exception 'PASSWORD_TOO_SHORT';
  end if;

  v_target_role := case when lower(trim(coalesce(p_target_role, 'viewer'))) = 'admin' then 'admin' else 'viewer' end;

  select * into st
  from public.dashboard_state
  where id = 'main'
  for update;

  if st.id is null then
    raise exception 'STATE_NOT_INITIALIZED';
  end if;

  v_existing := coalesce(st.users -> v_target, '{}'::jsonb);
  v_salt := encode(extensions.gen_random_bytes(16), 'hex');
  v_hash := public._hash_pass(v_salt, p_target_password);

  st.users := jsonb_set(
    st.users,
    array[v_target],
    jsonb_strip_nulls(jsonb_build_object(
      'username', v_target,
      'role', v_target_role,
      'salt', v_salt,
      'password_hash', v_hash,
      'created_at', coalesce(v_existing -> 'created_at', to_jsonb(v_now)),
      'created_by', coalesce(v_existing -> 'created_by', to_jsonb(v_actor)),
      'updated_at', to_jsonb(v_now),
      'last_login_at', v_existing -> 'last_login_at'
    )),
    true
  );

  update public.dashboard_state
  set users = st.users,
      updated_at = v_now
  where id = 'main';

  return query
  select * from public.get_dashboard_state(p_username, p_password);
end;
$$;

create or replace function public.delete_dashboard_user(
  p_username text,
  p_password text,
  p_target_username text
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
  v_actor text;
  v_target text;
  v_target_user jsonb;
  v_admin_count int;
begin
  v_actor := public._norm_user(p_username);
  v_target := public._norm_user(p_target_username);
  v_role := public._auth_dashboard_role(p_username, p_password);
  if v_role <> 'admin' then
    raise exception 'FORBIDDEN';
  end if;
  if v_target = '' then
    raise exception 'TARGET_USERNAME_REQUIRED';
  end if;
  if v_target = v_actor then
    raise exception 'CANNOT_DELETE_ACTIVE_USER';
  end if;

  select * into st
  from public.dashboard_state
  where id = 'main'
  for update;

  if st.id is null then
    raise exception 'STATE_NOT_INITIALIZED';
  end if;

  v_target_user := st.users -> v_target;
  if v_target_user is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  if coalesce(v_target_user ->> 'role', 'viewer') = 'admin' then
    select count(*)
    into v_admin_count
    from jsonb_each(st.users) as e(key, value)
    where coalesce(value ->> 'role', 'viewer') = 'admin';

    if v_admin_count <= 1 then
      raise exception 'CANNOT_DELETE_LAST_ADMIN';
    end if;
  end if;

  st.users := st.users - v_target;

  update public.dashboard_state
  set users = st.users,
      updated_at = now()
  where id = 'main';

  return query
  select * from public.get_dashboard_state(p_username, p_password);
end;
$$;

revoke all on function public.upsert_dashboard_user(text, text, text, text, text) from public;
revoke all on function public.delete_dashboard_user(text, text, text) from public;

grant execute on function public.upsert_dashboard_user(text, text, text, text, text) to anon, authenticated;
grant execute on function public.delete_dashboard_user(text, text, text) to anon, authenticated;
