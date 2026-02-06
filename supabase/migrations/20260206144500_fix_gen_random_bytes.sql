create or replace function public.get_dashboard_state(p_username text, p_password text)
returns table (
  users jsonb,
  likelihood jsonb,
  quarter_targets jsonb,
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
  updated_at := st.updated_at;
  role := v_role;
  return next;
end;
$$;
