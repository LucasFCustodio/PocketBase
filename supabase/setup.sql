-- PocketBase schema: projects -> directories (self-nesting) -> files.
-- Everything is owned by exactly one user and guarded by RLS.

create extension if not exists pgcrypto;

-- Projects ------------------------------------------------------------------

create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_user_idx on public.projects (user_id, updated_at desc);

-- Directories ---------------------------------------------------------------
-- parent_id null means a top-level scope. sort_order fixes chip positions so
-- number-key muscle memory works; it is never reordered by recency.

create table public.directories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  parent_id  uuid references public.directories (id) on delete cascade,
  name       text not null,
  sort_order int not null default 0,
  is_inbox   boolean not null default false,
  created_at timestamptz not null default now()
);

create index directories_project_idx on public.directories (project_id, parent_id, sort_order);

-- Exactly one Inbox per project. It is matched on this flag, never on its name,
-- because names are user-editable.
create unique index directories_one_inbox_per_project
  on public.directories (project_id) where is_inbox;

-- Files ---------------------------------------------------------------------
-- The idea itself. directory_id is deliberately nullable and freely mutable:
-- a file is inserted before it is filed, and re-filing is just an UPDATE.

create table public.files (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  directory_id uuid references public.directories (id) on delete set null,
  title        text not null default 'Untitled idea',
  body         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index files_recent_idx on public.files (user_id, updated_at desc);
create index files_directory_idx on public.files (directory_id);

-- updated_at ----------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger files_touch_updated_at
  before update on public.files
  for each row execute function public.touch_updated_at();

create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- Row level security --------------------------------------------------------
-- Ownership is enforced here, not in the frontend.

alter table public.projects    enable row level security;
alter table public.directories enable row level security;
alter table public.files       enable row level security;

create policy projects_own on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy directories_own on public.directories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy files_own on public.files
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
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
