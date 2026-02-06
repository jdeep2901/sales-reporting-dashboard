create or replace function public.save_dashboard_state(
  p_username text,
  p_password text,
  p_likelihood jsonb default null,
  p_quarter_targets jsonb default null,
  p_users jsonb default null
)
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

  update public.dashboard_state as d
  set likelihood = coalesce(p_likelihood, d.likelihood),
      quarter_targets = coalesce(p_quarter_targets, d.quarter_targets),
      users = coalesce(p_users, d.users),
      updated_at = now()
  where d.id = 'main'
  returning d.* into st;

  users := st.users;
  likelihood := st.likelihood;
  quarter_targets := st.quarter_targets;
  updated_at := st.updated_at;
  role := v_role;
  return next;
end;
$$;
