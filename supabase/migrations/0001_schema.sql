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
