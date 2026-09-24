# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

**PocketBase** is a web app for capturing and organizing project ideas.

Two ways in:

1. **Manual capture** — open the app, type the idea with a short elaboration,
   pick where it goes, save. This must be fast. Capture is the core loop.
2. **AI capture (later phase)** — ideas recorded on the user's device are sent
   through the Pocket AI API, classified automatically, and filed into the right
   place in the app without manual sorting.

Build (1) first and build it well. (2) is additive and must not complicate (1).

## Who it is for

Ideators, solo developers, and small teams building their own projects — the
person who is simultaneously the engineer, the marketer, and the strategist for
the thing they are making.

That person has ideas across every front of the project at once: a feature, a
landing-page headline, a pricing change, an SEO angle, a name for the next
release. The ideas arrive at random moments and land in notes apps, chat
threads, and scraps of paper, where they are never found again. Worse, the
*areas* themselves blur together — it is hard to see that marketing has been
neglected for a month while features pile up.

PocketBase solves both halves of that:

- **Organize the areas** a project needs attention on. The directory tree is
  not filing for its own sake; it is a map of the fronts the builder has to
  cover, visible at a glance.
- **Organize the ideas** within each area, so a thought about pricing lands
  next to the other pricing thoughts and can be picked up when that area gets
  worked on.

Design decisions should favor this user: someone with limited time, switching
context constantly, who will abandon the tool if filing an idea takes longer
than having it.

## Scope discipline

This is a course project (Engineering Design 2) and is meant to stay small. It
should do one thing well: capture an idea and file it where it can be found.

Before adding anything, ask whether it serves capture or retrieval. If it does
not, leave it out.

Small teams are part of the intended audience, but **the app is single-user for
now** and that is a deliberate simplification, not an oversight. Explicitly
**not** in scope: sharing, collaboration, team accounts, permissions,
multi-device sync, real-time updates, comments, notifications, tags beyond what
filtering needs, rich text editors, mobile apps, offline mode, file uploads,
search ranking, analytics.

Do not build hooks, abstractions, or schema "in preparation" for sharing or
syncing. If those ever arrive, they will be designed then.

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
  encourage going deep. `sort_order` fixes positions; `is_inbox` marks the one
  Inbox directory per project.
- **File** — the leaf. This is where the idea text lives: a title and a body.
  The title is derived from the first line of the body.

Everything is owned by a single user. There is no sharing.

**Seeded tree.** New projects (including the one created at signup, by a
trigger on `auth.users`) get a default tree so the user never faces an empty
folder list: `Inbox · Feature · Upgrades · Marketing · Money · Research`, with
`Marketing › SEO › Keywords / On-Page / Backlinks` as the one three-level
branch. See `supabase/migrations/0002_seed.sql`.

## Capture flow

The rule that shapes capture: **the idea is saved before any filing question
is asked.** The file is INSERTed (into the Inbox) the moment the user finishes
writing; every later step — project, area, sub-area — is an UPDATE. Abandoning
the flow at any point still keeps the idea. Do not reorder this.

- On Home, the capture card *is* the input. Ctrl/Cmd+Enter or "Evolve my
  Ideas" starts filing; the overlay must not show a second text box.
- The unsaved draft is held in `localStorage` (`pocketbase.draft`) until the
  insert lands, so a failed save loses nothing.
- Ideas can be moved later (the gear on a card re-opens the filing questions)
  and deleted (the only irreversible action, so it confirms first).

## Stack

- **Frontend** — plain HTML, CSS, and JavaScript. No framework, no build step,
  no bundler. ES modules loaded directly by the browser. If a dependency is
  needed, load it from a CDN rather than adding npm tooling to the frontend.
- **Backend** — Supabase is the backend. There is currently **no custom
  server code** in production. Node.js is reserved for the Pocket AI phase.
- **Database + Auth** — Supabase (Postgres + Supabase Auth).

### Where logic lives

Default to talking to Supabase **directly from the browser** using the
`@supabase/supabase-js` client and row-level security. This keeps the app
deployable as static files and removes a whole tier of code.

How requests flow in production: Netlify only hands the browser the HTML, CSS,
and JS. The JS then sends HTTPS requests from the user's browser straight to
Supabase's hosted REST/Auth API, which runs the query and answers. Supabase
replaces the "server in the middle" a traditional app would need: the anon key
identifies the project, the user's JWT identifies the user, and RLS in Postgres
decides what that user may touch.

Node.js is used only for work that genuinely cannot happen in the browser —
principally the Pocket AI API integration, which needs a secret API key that
must never be shipped to the client. Do not route ordinary CRUD through Node
"for consistency"; that is the kind of complexity this project is avoiding.

Never put a service-role key, or any secret, in frontend code. The Supabase
URL and anon key are safe to ship and live in `js/config.js`, committed on
purpose; RLS is what protects the data. `.env` is only for server-side
secrets (service-role key, Pocket AI key).

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
- The session lives in browser storage per origin, so logging in on localhost
  does not log you in on the deployed site — but the data is the same, because
  both talk to the same Supabase project.

## Pages

Three pages, no more. Home and Projects share a left sidebar
(`js/sidebar.js`) and use a Milanote-style board layout.

- **Home** (`index.html`) — the landing page after login. An inline capture
  card (the fastest path to a new idea), a stats row, the **Inbox** of
  unfiled ideas, **Where you left off** (the most recently updated files, each
  labeled with its project), and **Gathering dust** — the top-level areas of
  the current project that have gone 14+ days without a new or edited idea.
  That last panel is the "which front have I neglected" half of the product.
- **Projects** (`projects.html`) — the list of the user's projects. Clicking a
  project opens it and shows its folders and ideas, with breadcrumbs to move
  up and down the tree. Navigation within the page does not reload.
- **Login** (`login.html`) — email + password, with a way to register.

"Last worked on" is driven by an `updated_at` timestamp on files, touched by a
database trigger on every edit.

## Conventions

- Vanilla JS in ES modules. One module per concern; keep them short.
- A single shared module (`js/supabase.js`) owns the Supabase client and auth
  session — do not instantiate clients ad hoc across files.
- Keep DOM code and data-access code in separate modules. All queries live in
  `js/data.js`.
- Secrets come from environment config, never from files under `js/`. Keep a
  `.env.example` current; never commit `.env`.
- SQL schema and RLS policies live in the repo as migration files
  (`supabase/migrations/`) so the database can be rebuilt from scratch.
  `supabase/setup.sql` is the same migrations concatenated for pasting into
  the SQL editor in one go — keep it in sync when a migration changes.
- Write code a reader can follow on the first pass. Comment only where the
  reason for something is not obvious from the code.
- Save text files (including `README.md`) as UTF-8.

## Running locally

`node server.js` (optionally with a port) serves the repo root at
`http://127.0.0.1:3000`. It is a dependency-free static file server that exists
only because browsers will not load ES modules over `file://`. It is not
deployed and has no API routes.

## Deployment

The frontend deploys as static files to Netlify. There is no build step; the
publish directory is the repository root. Deploy sparingly — only when the
project is finished — to stay inside Netlify's free tier.

- Set Supabase **Authentication → URL Configuration → Site URL** to the
  Netlify URL.
- Supabase pauses free projects after about a week of inactivity. Use the app
  shortly before submitting and around grading time; restore from the Supabase
  dashboard if it paused.
- Graders who register get their own, empty account (RLS). Anything they
  should see populated has to be shown in the demo video or via a demo account.

Any future Node.js backend work (Pocket AI) should be written as a Netlify
Function: same origin, no CORS setup, no separate host. A separate always-on
service (e.g. Render) is not needed for anything the app does today, and its
free tier adds cold starts and cross-origin setup. Confirm the approach before
building out a separate hosted Node service.

## Assignment deliverables

The course (Engineering Design 2, "Build software with AI") grades on:

| Category | Points | What it wants |
| --- | --- | --- |
| Hootcamp material | 10 | Concepts from the lectures visible in the implementation |
| GitHub repository | 15 | Public, organized, meaningful and regular commits |
| Application functionality | 40 | Database + auth integrated, data stored and retrieved correctly, frontend ↔ backend interaction |
| Documentation | 10 | README: project, setup, technologies, how to run |
| Demo video (3–5 min) | 25 | Purpose, features, code structure, design decisions |

The README must include: name and description, link to the deployed app, a
link to an **unlisted** YouTube demo (3–5 min, on the *deployed* site, showing
registration, login, database functionality, and a code/structure walkthrough),
what the app does, technologies used, setup instructions.

Required app surface: register, log in, log out, view data, and full CRUD, with
authentication required before creating or modifying data.

## Git

- Public GitHub repository (`LucasFCustodio/PocketBase`); commit regularly with
  meaningful messages.
- Commit in small, working increments rather than one large drop.
- Branch for features and merge via pull request where practical.
