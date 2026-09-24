# PocketBase

A place to put an idea before it disappears.

**Live app:** <https://symphonious-arithmetic-c33539.netlify.app/>
**Demo video (YouTube, unlisted):** [PLACEHOLDER — video link coming soon](https://www.youtube.com/)

## What it does

PocketBase is for people building their own projects (solo developers,
ideators, small teams) who have ideas on every front at once: a feature, a
landing-page headline, a pricing change, an SEO angle. Those ideas usually end
up in notes apps and chat threads and are never found again.

PocketBase keeps each idea in a folder tree for its project, so a pricing
thought sits next to the other pricing thoughts. It also shows which areas of a
project have been neglected.

The app follows one rule: **writing the idea down comes first, and filing it
never gets in the way.** You type the idea, answer two or three one-tap
questions, and it's filed. The idea is saved to the database as soon as you
finish typing, so it's kept even if you stop partway through filing.

### Features

- **Register, log in, log out** with email and password. New accounts confirm
  their email address once, through a link Supabase sends. Each account only
  sees its own data.
- **Capture an idea from Home.** Type into the card and press
  `Ctrl + Enter` (or click **Evolve my Ideas**).
- **File it in a few taps:** pick the project, then the area, then an optional
  sub-area.
- **Browse projects** on the Projects page, moving down through folders to the
  ideas inside.
- **Create** projects, folders, and ideas. **Read** them on Home and Projects.
  **Update** an idea's text or move it to another folder. **Delete** ideas.
- **Home dashboard:**
  - *Inbox*: ideas you haven't filed yet.
  - *Where you left off*: your most recently edited ideas, each labeled with
    its project.
  - *Gathering dust*: areas of your project with no new or edited ideas in
    14+ days.
- **Starter folders:** every new project begins with a default set of folders,
  so you never have to name folders before capturing:

  ```
  Inbox · Feature · Upgrades · Marketing · Money · Research
  ```

  `Marketing › SEO › Keywords / On-Page / Backlinks` is the one branch that
  goes three levels deep.

### How capture works

```
type the idea → Evolve it → which project? → which area? → more specific? → done
             │
             └─ saved to the database here, before any question is asked
```

Each tap after that only moves the file. Press `Esc` at any point and the idea
stays wherever it got to.

## Technologies used

| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS, and vanilla JavaScript (ES modules). No framework, no build step. |
| Database | Supabase Postgres: `projects`, `directories`, `files` tables |
| Authentication | Supabase Auth (email + password) |
| Security | Postgres row-level security: every row is limited to `auth.uid() = user_id` |
| Client library | `@supabase/supabase-js`, loaded from a CDN |
| Hosting | Netlify (static files) |
| Local dev server | Node.js (`server.js`, no dependencies) |
| Development | Built with AI tooling (Claude Code), per the Hootcamp lectures |

### How the frontend and backend talk

Netlify only serves the HTML, CSS, and JavaScript files. After the page loads,
the JavaScript in your browser sends HTTPS requests straight to Supabase's
hosted API to log in and to read and write data. Supabase acts as the backend:
it checks the logged-in user's token, and the row-level security policies in
Postgres make sure each user can only read and change their own rows. No
custom server is needed.

```
Browser ──(HTML/CSS/JS)──────────────────► Netlify
   │
   └──(login, select, insert, update, delete)──► Supabase (Auth + Postgres + RLS)
```

## Setup instructions

You need [Node.js](https://nodejs.org) (only to run the local file server) and
a free [Supabase](https://supabase.com) account.

**1. Clone the repository.**

```sh
git clone https://github.com/LucasFCustodio/PocketBase.git
cd PocketBase
```

**2. Create a Supabase project** at [supabase.com](https://supabase.com). The
free tier is enough.

**3. Check email confirmation.** In *Authentication → Sign In / Providers →
Email*, leave "Confirm email" on. Supabase sends each new user a
confirmation link, and they can log in after clicking it.

**4. Create the database.** Open the Supabase **SQL Editor**, paste the whole
of `supabase/setup.sql`, and run it. It creates the tables, indexes,
row-level security policies, and the trigger that gives each new user a
starter project.

The same SQL is also split into migrations in `supabase/migrations/`
(`0001_schema.sql`, then `0002_seed.sql`), so you can use the Supabase CLI
instead:

```sh
supabase link --project-ref <your-project-ref>
supabase db push
```

**5. Add your Supabase keys.** In *Project Settings → API*, copy the project
URL and the **anon** public key into `js/config.js`:

```js
export const SUPABASE_URL = 'https://<your-project>.supabase.co';
export const SUPABASE_ANON_KEY = '<your-anon-key>';
```

Both values are safe to commit. The anon key only identifies the project, and
row-level security is what protects the data. The **service role key is not
safe** and must never go in any file under `js/`.

**6. Run it locally.**

```sh
node server.js
```

Open <http://127.0.0.1:3000>, register an account, and write your first idea.
To use a different port, run `node server.js 8080`. The app has to be served
over HTTP because browsers won't load ES modules from `file://`.

## Deploying

1. In Netlify, choose **Add new site → Import an existing project** and connect
   this GitHub repository, or drag the project folder onto Netlify.
2. Leave the build command empty. The publish directory is the repository
   root.
3. In Supabase, go to *Authentication → URL Configuration* and set the **Site
   URL** to your Netlify address. The confirmation link in sign-up emails
   sends users there.

Note: Supabase pauses free projects after about a week with no activity. If the
live app can't log in, restore the project from the Supabase dashboard.

## Project structure

```
index.html              Home: capture card, stats, Inbox, recent ideas, Gathering dust
projects.html           Browse projects, folders, and ideas
login.html              Register and log in
css/style.css           All styling
js/config.js            Supabase URL and anon key
js/supabase.js          The single shared Supabase client and session helpers
js/auth.js              Register / log in
js/data.js              All database queries (no DOM code)
js/capture.js           The capture/filing flow and the idea editor
js/home.js              Home page
js/projects.js          Projects page
js/sidebar.js           Sidebar shared by Home and Projects (navigation, log out)
supabase/setup.sql      Full database setup in one file
supabase/migrations/    The same setup split into migrations: schema + RLS, then starter folders
server.js               Local development file server (not deployed)
.env.example            Server-side secrets for the future AI capture feature
```

## Roadmap

**AI capture:** ideas recorded on your device would be sent through the
Pocket AI API, classified automatically, and filed in the right folder. That
needs a secret API key, so it will run as a Netlify Function and not in the
browser.
