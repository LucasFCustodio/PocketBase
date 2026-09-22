# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

**PocketBase** is a web app for capturing and organizing project ideas.

The problem it solves: good ideas arrive at random moments and get lost in notes
apps, chat threads, and scraps of paper. PocketBase gives them one home, filed
under the project they belong to, so they can be found again.

Two ways in:

1. **Manual capture** — open the app, type the idea with a short elaboration,
   pick where it goes, save. This must be fast. Capture is the core loop.
2. **AI capture (later phase)** — ideas recorded on the user's device are sent
   through the Pocket AI API, classified automatically, and filed into the right
   place in the app without manual sorting.

Build (1) first and build it well. (2) is additive and must not complicate (1).

## Scope discipline

This is a course project (Engineering Design 2) and is meant to stay small. It
should do one thing well: capture an idea and file it where it can be found.

Before adding anything, ask whether it serves capture or retrieval. If it does
not, leave it out. Explicitly **not** in scope: sharing/collaboration, teams,
comments, notifications, tags beyond what filtering needs, rich text editors,
mobile apps, offline sync, file uploads, search ranking, analytics.

Prefer boring, obvious solutions over clever ones. Prefer fewer files. Prefer
plain functions over abstractions that have exactly one caller.

## Data model

The organizing idea is a folder tree scoped to a project.

```
Project            e.g. "DollarSeeds" (a budgeting app the user is building)
└── Directory      e.g. "Marketing", "SEO", "Features"
    └── Directory  e.g. "Features/Recurring Transactions"   (nestable)
        └── File   e.g. "Structure", "Design"
```

- **Project** — top-level container. Belongs to one user.
- **Directory** — a folder inside a project. May nest inside another directory
  (self-referencing `parent_id`). Arbitrary depth, but the UI does not need to
  encourage going deep.
- **File** — the leaf. This is where the idea text lives: a title and a body.

Everything is owned by a single user. There is no sharing.

## Stack

- **Frontend** — plain HTML, CSS, and JavaScript. No framework, no build step,
  no bundler. ES modules loaded directly by the browser. If a dependency is
  needed, load it from a CDN rather than adding npm tooling to the frontend.
- **Backend** — Node.js. Kept deliberately thin (see below).
- **Database + Auth** — Supabase (Postgres + Supabase Auth).

### Where logic lives

Default to talking to Supabase **directly from the browser** using the
`@supabase/supabase-js` client and row-level security. This keeps the app
deployable as static files and removes a whole tier of code.

The Node.js backend exists only for work that genuinely cannot happen in the
browser — principally the Pocket AI API integration, which needs a secret API
key that must never be shipped to the client. Do not route ordinary CRUD
through Node "for consistency"; that is the kind of complexity this project is
avoiding.

Never put a service-role key, or any secret, in frontend code. The Supabase
anon key is safe to ship; RLS is what protects the data.

## Authentication

Supabase Auth with email + password.

- **No email integration.** No confirmation emails, no magic links, no password
  reset flow. The user chooses an email and password at registration and uses
  the same pair to log in afterward. Email confirmation must be disabled in the
  Supabase project settings.
- Register, log in, log out. That is the whole surface.
- Every project, directory, and file row carries a `user_id`. RLS policies
  restrict all reads and writes to `auth.uid() = user_id`. Do not rely on the
  frontend hiding things — enforce ownership in the database.
- Unauthenticated visitors get redirected to the login page.

## Pages

Three pages, no more.

- **Home** — the landing page after login. Shows the last 3 files the user
  worked on, each labeled with the project it belongs to, so the user can jump
  straight back in. Should also offer the fastest possible path to creating a
  new idea.
- **Projects** — the list of the user's projects. Clicking a project opens it
  and shows the directories and files inside, and lets the user navigate down
  the tree.
- **Login** — email + password, with a way to register.

"Last worked on" is driven by an `updated_at` timestamp on files, touched on
every edit.

## Conventions

- Vanilla JS in ES modules. One module per concern; keep them short.
- A single shared module owns the Supabase client and auth session — do not
  instantiate clients ad hoc across files.
- Keep DOM code and data-access code in separate modules.
- Secrets and project URLs come from environment config, not hardcoded literals
  checked into git. Keep a `.env.example` current; never commit `.env`.
- SQL schema and RLS policies live in the repo as migration files so the
  database can be rebuilt from scratch.
- Write code a reader can follow on the first pass. Comment only where the
  reason for something is not obvious from the code.

## Deployment

The frontend deploys as static files to Netlify. Deploy sparingly — only when
the project is finished — to stay inside Netlify's free tier.

Because Netlify serves static files, any Node.js backend work should be written
as a Netlify Function rather than a long-running server, unless there is a
concrete reason otherwise. Confirm the approach before building out a separate
hosted Node service.

## Git

- Public GitHub repository; commit regularly with meaningful messages.
- Commit in small, working increments rather than one large drop.
- Branch for features and merge via pull request where practical.
