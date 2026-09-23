-- The default directory tree, plus the hooks that make sure a user always has
-- a project to file into. The zero-project state must never exist inside the
-- capture flow, so a project is seeded at signup.

-- Insert one directory and hand back its id.
create or replace function public.seed_dir(
  p_user_id    uuid,
  p_project_id uuid,
  p_parent_id  uuid,
  p_name       text,
  p_sort       int,
  p_is_inbox   boolean default false
)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.directories (user_id, project_id, parent_id, name, sort_order, is_inbox)
  values (p_user_id, p_project_id, p_parent_id, p_name, p_sort, p_is_inbox)
  returning id;
$$;

-- The seed tree: Inbox + 5 scopes + their children. SEO is the one branch that
-- goes three levels deep, so it is what exercises the optional third chip row.
create or replace function public.seed_project_tree(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  u  uuid;
  p  uuid := p_project_id;
  d_feature   uuid;
  d_upgrades  uuid;
  d_marketing uuid;
  d_money     uuid;
  d_research  uuid;
  d_seo       uuid;
begin
  select user_id into u from public.projects where id = p;
  if u is null then
    raise exception 'seed_project_tree: project % not found', p;
  end if;

  -- Never offered as a chip; this is where unfiled ideas land.
  perform public.seed_dir(u, p, null, 'Inbox', 0, true);

  d_feature   := public.seed_dir(u, p, null, 'Feature',   1);
  d_upgrades  := public.seed_dir(u, p, null, 'Upgrades',  2);
  d_marketing := public.seed_dir(u, p, null, 'Marketing', 3);
  d_money     := public.seed_dir(u, p, null, 'Money',     4);
  d_research  := public.seed_dir(u, p, null, 'Research',  5);

  perform public.seed_dir(u, p, d_feature, 'Structure',    1);
  perform public.seed_dir(u, p, d_feature, 'Design',       2);
  perform public.seed_dir(u, p, d_feature, 'Integrations', 3);

  perform public.seed_dir(u, p, d_upgrades, 'Design',      1);
  perform public.seed_dir(u, p, d_upgrades, 'Performance', 2);
  perform public.seed_dir(u, p, d_upgrades, 'Fixes',       3);

  perform public.seed_dir(u, p, d_marketing, 'Content', 1);
  perform public.seed_dir(u, p, d_marketing, 'Social',  2);
  perform public.seed_dir(u, p, d_marketing, 'Launch',  3);
  d_seo := public.seed_dir(u, p, d_marketing, 'SEO',    4);

  perform public.seed_dir(u, p, d_seo, 'Keywords',  1);
  perform public.seed_dir(u, p, d_seo, 'On-Page',   2);
  perform public.seed_dir(u, p, d_seo, 'Backlinks', 3);

  perform public.seed_dir(u, p, d_money, 'Pricing', 1);
  perform public.seed_dir(u, p, d_money, 'Plans',   2);
  perform public.seed_dir(u, p, d_money, 'Costs',   3);

  perform public.seed_dir(u, p, d_research, 'Competitors', 1);
  perform public.seed_dir(u, p, d_research, 'Users',       2);
  perform public.seed_dir(u, p, d_research, 'Market',      3);
end;
$$;

-- Creating a project always seeds its tree, so the client never has to.
create or replace function public.create_project(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'create_project: not authenticated';
  end if;

  insert into public.projects (user_id, name)
  values (auth.uid(), coalesce(nullif(trim(p_name), ''), 'Untitled project'))
  returning id into v_id;

  perform public.seed_project_tree(v_id);
  return v_id;
end;
$$;

grant execute on function public.create_project(text) to authenticated;

-- Every new user gets a project and a full tree before they ever reach the app.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.projects (user_id, name)
  values (new.id, 'My First Project')
  returning id into v_id;

  perform public.seed_project_tree(v_id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
