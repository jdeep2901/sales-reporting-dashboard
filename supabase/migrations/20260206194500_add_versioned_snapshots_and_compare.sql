create table if not exists public.dashboard_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text not null,
  source text not null default 'monday_sync',
  board_id text,
  board_name text,
  dataset jsonb not null,
  likelihood jsonb not null default '{}'::jsonb,
  dataset_hash text not null,
  item_count int not null default 0,
  notes text
);

create index if not exists dashboard_versions_created_at_idx on public.dashboard_versions (created_at desc);
create index if not exists dashboard_versions_board_created_idx on public.dashboard_versions (board_id, created_at desc);
create index if not exists dashboard_versions_hash_idx on public.dashboard_versions (dataset_hash);

alter table public.dashboard_state
  add column if not exists active_version_id uuid,
  add column if not exists latest_version_id uuid;

do $$
declare
  v_inserted uuid;
begin
  if exists (
    select 1
    from public.dashboard_state
    where id = 'main'
      and dataset is not null
  ) and not exists (select 1 from public.dashboard_versions) then
    insert into public.dashboard_versions (
      created_by, source, board_id, board_name, dataset, likelihood, dataset_hash, item_count, notes
    )
    select
      'bootstrap',
      'bootstrap',
      coalesce(settings ->> 'monday_board_id', null),
      coalesce(settings ->> 'monday_board_name', null),
      dataset,
      coalesce(likelihood, '{}'::jsonb),
      encode(extensions.digest(dataset::text, 'sha256'), 'hex'),
      coalesce(
        (select count(*) from jsonb_array_elements(coalesce(dataset #> '{scorecard,sellers,All (unique deals),kpi_details,stage_1_6}', '[]'::jsonb))),
        0
      ),
      'Backfilled initial version from dashboard_state'
    from public.dashboard_state
    where id = 'main'
    returning id into v_inserted;

    update public.dashboard_state
    set latest_version_id = v_inserted,
        active_version_id = v_inserted
    where id = 'main';
  end if;
end $$;

create or replace function public._auth_dashboard_role(p_username text, p_password text)
returns text
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

  select * into st from public.dashboard_state where id = 'main';
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
  return v_role;
end;
$$;

create or replace function public._stage_counts_for_seller(p_dataset jsonb, p_seller text)
returns jsonb
language sql
immutable
as $$
  with recs as (
    select x ->> 'stage' as stage
    from jsonb_array_elements(coalesce(p_dataset #> array['scorecard','sellers',p_seller,'kpi_details','stage_1_6'], '[]'::jsonb)) x
    union all
    select y ->> 'stage' as stage
    from jsonb_array_elements(coalesce(p_dataset #> array['scorecard','sellers',p_seller,'kpi_details','stage_7_8'], '[]'::jsonb)) y
  ),
  labels as (
    select * from (values
      ('1. Intro'),
      ('2. Qualification'),
      ('3. Capability'),
      ('4. Problem Scoping'),
      ('5. Contracting'),
      ('6. Commercial Proposal'),
      ('7. Win'),
      ('8. Loss')
    ) as v(stage)
  )
  select coalesce(jsonb_object_agg(l.stage, coalesce(c.cnt, 0)), '{}'::jsonb)
  from labels l
  left join (
    select stage, count(*)::int as cnt
    from recs
    group by stage
  ) c on c.stage = l.stage;
$$;

drop function if exists public.get_dashboard_state(text, text);
drop function if exists public.save_dashboard_state(text, text, jsonb, jsonb, jsonb, jsonb, jsonb);

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
        'source', v.source
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
        'source', v.source
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

create or replace function public.get_dashboard_version(
  p_username text,
  p_password text,
  p_version_id uuid
)
returns table (
  version_id uuid,
  dataset jsonb,
  likelihood jsonb,
  created_at timestamptz,
  created_by text
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
  select v.id, v.dataset, v.likelihood, v.created_at, v.created_by
  from public.dashboard_versions v
  where v.id = p_version_id;

  if not found then
    raise exception 'VERSION_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.get_dashboard_compare(
  p_username text,
  p_password text,
  p_left_version_id uuid,
  p_right_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  left_dataset jsonb;
  right_dataset jsonb;
  left_meta jsonb;
  right_meta jsonb;
  sellers text[] := array['Somya','Akshay Iyer','Abhinav Kishore','Maruti Peri','Vitor Quirino'];
  seller text;
  labels text[] := array['1. Intro','2. Qualification','3. Capability','4. Problem Scoping','5. Contracting','6. Commercial Proposal','7. Win','8. Loss'];
  stage_label text;
  left_counts jsonb;
  right_counts jsonb;
  left_val int;
  right_val int;
  delta_val int;
  pct_delta numeric;
  seller_stage_rows jsonb;
  stage_deltas jsonb := '[]'::jsonb;
  stuck_deltas jsonb := '[]'::jsonb;
  intro_deltas jsonb := '[]'::jsonb;
  left_stuck int;
  right_stuck int;
  left_intro_total int;
  right_intro_total int;
  left_intro_avg numeric;
  right_intro_avg numeric;
  left_intro_peak int;
  right_intro_peak int;
  left_series jsonb;
  right_series jsonb;
  seller_compare_key text;
  movement jsonb;
begin
  v_role := public._auth_dashboard_role(p_username, p_password);

  select v.dataset,
         jsonb_build_object('id', v.id, 'created_at', v.created_at, 'created_by', v.created_by, 'board_id', v.board_id, 'board_name', v.board_name, 'item_count', v.item_count)
  into left_dataset, left_meta
  from public.dashboard_versions v
  where v.id = p_left_version_id;
  if left_dataset is null then
    raise exception 'LEFT_VERSION_NOT_FOUND';
  end if;

  select v.dataset,
         jsonb_build_object('id', v.id, 'created_at', v.created_at, 'created_by', v.created_by, 'board_id', v.board_id, 'board_name', v.board_name, 'item_count', v.item_count)
  into right_dataset, right_meta
  from public.dashboard_versions v
  where v.id = p_right_version_id;
  if right_dataset is null then
    raise exception 'RIGHT_VERSION_NOT_FOUND';
  end if;

  foreach seller in array sellers loop
    left_counts := public._stage_counts_for_seller(left_dataset, seller);
    right_counts := public._stage_counts_for_seller(right_dataset, seller);
    seller_stage_rows := '[]'::jsonb;

    foreach stage_label in array labels loop
      left_val := coalesce((left_counts ->> stage_label)::int, 0);
      right_val := coalesce((right_counts ->> stage_label)::int, 0);
      delta_val := right_val - left_val;
      pct_delta := case when left_val = 0 then null else round(((right_val - left_val)::numeric / left_val::numeric) * 100, 1) end;
      seller_stage_rows := seller_stage_rows || jsonb_build_array(
        jsonb_build_object(
          'stage', stage_label,
          'left', left_val,
          'right', right_val,
          'delta', delta_val,
          'pct_delta', pct_delta
        )
      );
    end loop;

    stage_deltas := stage_deltas || jsonb_build_array(
      jsonb_build_object('seller', seller, 'rows', seller_stage_rows)
    );

    left_stuck := jsonb_array_length(coalesce(left_dataset #> array['scorecard','sellers',seller,'kpi_details','stuck_proxy_2_6'], '[]'::jsonb));
    right_stuck := jsonb_array_length(coalesce(right_dataset #> array['scorecard','sellers',seller,'kpi_details','stuck_proxy_2_6'], '[]'::jsonb));
    stuck_deltas := stuck_deltas || jsonb_build_array(
      jsonb_build_object(
        'seller', seller,
        'left', left_stuck,
        'right', right_stuck,
        'delta', right_stuck - left_stuck,
        'pct_delta', case when left_stuck = 0 then null else round(((right_stuck - left_stuck)::numeric / left_stuck::numeric) * 100, 1) end
      )
    );

    seller_compare_key := seller;
    left_series := coalesce(left_dataset #> array['intro_trend','series',seller_compare_key], '{}'::jsonb);
    right_series := coalesce(right_dataset #> array['intro_trend','series',seller_compare_key], '{}'::jsonb);
    left_intro_total := coalesce((select sum((value)::int) from jsonb_each_text(left_series)), 0);
    right_intro_total := coalesce((select sum((value)::int) from jsonb_each_text(right_series)), 0);
    left_intro_avg := coalesce((select avg((value)::numeric) from jsonb_each_text(left_series)), 0);
    right_intro_avg := coalesce((select avg((value)::numeric) from jsonb_each_text(right_series)), 0);
    left_intro_peak := coalesce((select max((value)::int) from jsonb_each_text(left_series)), 0);
    right_intro_peak := coalesce((select max((value)::int) from jsonb_each_text(right_series)), 0);
    intro_deltas := intro_deltas || jsonb_build_array(
      jsonb_build_object(
        'seller', seller,
        'left_total', left_intro_total,
        'right_total', right_intro_total,
        'delta_total', right_intro_total - left_intro_total,
        'left_avg', round(left_intro_avg, 2),
        'right_avg', round(right_intro_avg, 2),
        'delta_avg', round(right_intro_avg - left_intro_avg, 2),
        'left_peak', left_intro_peak,
        'right_peak', right_intro_peak,
        'delta_peak', right_intro_peak - left_intro_peak
      )
    );
  end loop;

  with left_rows as (
    select
      lower(trim(x ->> 'deal')) || '||' || lower(trim(coalesce(x ->> 'seller', ''))) || '||' || lower(trim(coalesce(x ->> 'created_month', ''))) as dkey,
      x ->> 'deal' as deal,
      x ->> 'seller' as seller,
      x ->> 'created_month' as intro_month,
      x ->> 'stage' as stage
    from jsonb_array_elements(coalesce(left_dataset #> '{scorecard,sellers,All (unique deals),kpi_details,stage_1_6}', '[]'::jsonb)) x
    union all
    select
      lower(trim(y ->> 'deal')) || '||' || lower(trim(coalesce(y ->> 'seller', ''))) || '||' || lower(trim(coalesce(y ->> 'created_month', ''))) as dkey,
      y ->> 'deal' as deal,
      y ->> 'seller' as seller,
      y ->> 'created_month' as intro_month,
      y ->> 'stage' as stage
    from jsonb_array_elements(coalesce(left_dataset #> '{scorecard,sellers,All (unique deals),kpi_details,stage_7_8}', '[]'::jsonb)) y
  ),
  right_rows as (
    select
      lower(trim(x ->> 'deal')) || '||' || lower(trim(coalesce(x ->> 'seller', ''))) || '||' || lower(trim(coalesce(x ->> 'created_month', ''))) as dkey,
      x ->> 'deal' as deal,
      x ->> 'seller' as seller,
      x ->> 'created_month' as intro_month,
      x ->> 'stage' as stage
    from jsonb_array_elements(coalesce(right_dataset #> '{scorecard,sellers,All (unique deals),kpi_details,stage_1_6}', '[]'::jsonb)) x
    union all
    select
      lower(trim(y ->> 'deal')) || '||' || lower(trim(coalesce(y ->> 'seller', ''))) || '||' || lower(trim(coalesce(y ->> 'created_month', ''))) as dkey,
      y ->> 'deal' as deal,
      y ->> 'seller' as seller,
      y ->> 'created_month' as intro_month,
      y ->> 'stage' as stage
    from jsonb_array_elements(coalesce(right_dataset #> '{scorecard,sellers,All (unique deals),kpi_details,stage_7_8}', '[]'::jsonb)) y
  ),
  joined as (
    select
      coalesce(l.dkey, r.dkey) as dkey,
      l.deal as l_deal, l.seller as l_seller, l.intro_month as l_month, l.stage as l_stage,
      r.deal as r_deal, r.seller as r_seller, r.intro_month as r_month, r.stage as r_stage
    from left_rows l
    full join right_rows r on l.dkey = r.dkey
  ),
  added_rows as (
    select jsonb_build_object('deal', r_deal, 'seller', r_seller, 'intro_month', r_month, 'stage', r_stage) as row
    from joined where l_deal is null and r_deal is not null
    order by lower(r_deal) limit 50
  ),
  removed_rows as (
    select jsonb_build_object('deal', l_deal, 'seller', l_seller, 'intro_month', l_month, 'stage', l_stage) as row
    from joined where r_deal is null and l_deal is not null
    order by lower(l_deal) limit 50
  ),
  stage_changed_rows as (
    select jsonb_build_object(
      'deal', coalesce(r_deal, l_deal),
      'seller', coalesce(r_seller, l_seller),
      'intro_month', coalesce(r_month, l_month),
      'left_stage', l_stage,
      'right_stage', r_stage
    ) as row
    from joined
    where l_deal is not null and r_deal is not null and coalesce(l_stage, '') <> coalesce(r_stage, '')
    order by lower(coalesce(r_deal, l_deal))
    limit 50
  ),
  counts as (
    select
      (select count(*) from joined where l_deal is null and r_deal is not null) as added_count,
      (select count(*) from joined where r_deal is null and l_deal is not null) as removed_count,
      (select count(*) from joined where l_deal is not null and r_deal is not null and coalesce(l_stage, '') <> coalesce(r_stage, '')) as stage_changed_count,
      (select count(*) from joined where l_deal is not null and r_deal is not null and coalesce(l_stage, '') = coalesce(r_stage, '')) as unchanged_count
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'added', c.added_count,
      'removed', c.removed_count,
      'stage_changed', c.stage_changed_count,
      'unchanged', c.unchanged_count
    ),
    'added', coalesce((select jsonb_agg(row) from added_rows), '[]'::jsonb),
    'removed', coalesce((select jsonb_agg(row) from removed_rows), '[]'::jsonb),
    'stage_changed', coalesce((select jsonb_agg(row) from stage_changed_rows), '[]'::jsonb)
  )
  into movement
  from counts c;

  return jsonb_build_object(
    'left_version', left_meta,
    'right_version', right_meta,
    'stage_deltas', stage_deltas,
    'stuck_deltas', stuck_deltas,
    'intro_deltas', intro_deltas,
    'movement', movement
  );
end;
$$;

revoke all on function public.get_dashboard_state(text, text) from public;
revoke all on function public.save_dashboard_state(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) from public;
revoke all on function public.get_dashboard_version(text, text, uuid) from public;
revoke all on function public.get_dashboard_compare(text, text, uuid, uuid) from public;
revoke all on function public._auth_dashboard_role(text, text) from public;

grant execute on function public.get_dashboard_state(text, text) to anon, authenticated;
grant execute on function public.save_dashboard_state(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) to anon, authenticated;
grant execute on function public.get_dashboard_version(text, text, uuid) to anon, authenticated;
grant execute on function public.get_dashboard_compare(text, text, uuid, uuid) to anon, authenticated;
