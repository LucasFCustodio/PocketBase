// The left sidebar, shared by Home and Projects so the markup exists once.
// It is the main navigation and the reason neither page looks empty.

import { currentUser, signOut } from './supabase.js';
import { listProjectsWithCounts, inboxCount, loadTree } from './data.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A stable hash so a project keeps the same tint across pages and reloads,
// without needing a column to store it in.
export function tintOf(id) {
  const sum = String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return (sum % 6) + 1;
}

export async function renderSidebar({ active, onNewIdea }) {
  const el = document.querySelector('#sidebar');
  if (!el) return;

  const [user, projects, unfiled] = await Promise.all([
    currentUser(), listProjectsWithCounts(), inboxCount(),
  ]);

  const on = (page) => (active === page ? ' is-active' : '');

  el.innerHTML = [
    '<div class="brand">',
    '  <span class="brand-mark">P</span>',
    '  <span class="brand-name">PocketBase</span>',
    '</div>',

    '<button class="btn btn--primary btn--block" id="side-new">+ New idea</button>',

    '<nav class="side-group">',
    '  <a class="side-link' + on('home') + '" href="index.html">Home</a>',
    '  <a class="side-link' + on('projects') + '" href="projects.html">Projects</a>',
    '  <a class="side-link" href="projects.html#inbox"><span class="grow">Inbox</span>',
    unfiled ? '<span class="badge badge--accent">' + unfiled + '</span>' : '',
    '  </a>',
    '</nav>',

    '<div class="side-group">',
    '  <p class="caption side-caption">Projects</p>',
    projects.map((p) =>
      '<details class="side-project" data-id="' + esc(p.id) + '" data-tint="' + tintOf(p.id) + '">' +
      '<summary><span class="dot"></span><span class="grow">' + esc(p.name) + '</span>' +
      '<span class="badge">' + p.fileCount + '</span></summary>' +
      '<div class="side-sub"></div></details>').join(''),
    projects.length ? '' : '<p class="row-sub" style="padding:0 var(--s2)">No projects yet.</p>',
    '</div>',

    '<div class="side-foot">',
    '  <p class="side-user">' + esc(user?.email ?? '') + '</p>',
    '  <button class="btn btn--ghost btn--block" id="side-out">Log out</button>',
    '</div>',
  ].join('');

  el.querySelector('#side-new').addEventListener('click', onNewIdea);
  el.querySelector('#side-out').addEventListener('click', signOut);

  // Folders load only when a project is actually expanded — one query on
  // demand rather than a query per project on every page load.
  el.querySelectorAll('.side-project').forEach((node) => {
    node.addEventListener('toggle', async () => {
      const sub = node.querySelector('.side-sub');
      if (!node.open || sub.dataset.loaded) return;
      sub.dataset.loaded = '1';

      const tree = await loadTree(node.dataset.id);
      const tops = tree.filter((d) => d.parent_id === null && !d.is_inbox);
      sub.innerHTML = tops.length
        ? tops.map((d) => '<a class="side-link" href="projects.html#dir-' + esc(d.id) +
            '">' + esc(d.name) + '</a>').join('')
        : '<p class="row-sub">No folders</p>';
    });
  });
}
