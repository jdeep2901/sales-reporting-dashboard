alter table public.dashboard_state
  add column if not exists settings jsonb not null default '{}'::jsonb,
  add column if not exists dataset jsonb,
  add column if not exists dataset_refreshed_at timestamptz;

drop function if exists public.get_dashboard_state(text, text);

create or replace function public.get_dashboard_state(p_username text, p_password text)
returns table (
  users jsonb,
  likelihood jsonb,
  quarter_targets jsonb,
  settings jsonb,
  dataset jsonb,
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

    users := st.users;
    likelihood := st.likelihood;
    quarter_targets := st.quarter_targets;
    settings := st.settings;
    dataset := st.dataset;
    updated_at := st.updated_at;
    role := 'admin';
    return next;
    return;
  end if;

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

  users := st.users;
  likelihood := st.likelihood;
  quarter_targets := st.quarter_targets;
  settings := st.settings;
  dataset := st.dataset;
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
  p_dataset jsonb default null
)
returns table (
  users jsonb,
  likelihood jsonb,
  quarter_targets jsonb,
  settings jsonb,
  dataset jsonb,
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
    raise exception 'STATE_NOT_INITIALIZED';
  end if;

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

  if p_users is not null and v_role <> 'admin' then
    raise exception 'FORBIDDEN_USERS_UPDATE';
  end if;
  if p_settings is not null and v_role <> 'admin' then
    raise exception 'FORBIDDEN_SETTINGS_UPDATE';
  end if;
  if p_dataset is not null and v_role <> 'admin' then
    raise exception 'FORBIDDEN_DATASET_UPDATE';
  end if;

  update public.dashboard_state as d
  set likelihood = coalesce(p_likelihood, d.likelihood),
      quarter_targets = coalesce(p_quarter_targets, d.quarter_targets),
      users = coalesce(p_users, d.users),
      settings = coalesce(p_settings, d.settings),
      dataset = coalesce(p_dataset, d.dataset),
      dataset_refreshed_at = case when p_dataset is not null then now() else d.dataset_refreshed_at end,
      updated_at = now()
  where d.id = 'main'
  returning * into st;

  users := st.users;
  likelihood := st.likelihood;
  quarter_targets := st.quarter_targets;
  settings := st.settings;
  dataset := st.dataset;
  updated_at := st.updated_at;
  role := v_role;
  return next;
end;
$$;

revoke all on function public.get_dashboard_state(text, text) from public;
revoke all on function public.save_dashboard_state(text, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public;

grant execute on function public.get_dashboard_state(text, text) to anon, authenticated;
grant execute on function public.save_dashboard_state(text, text, jsonb, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;
