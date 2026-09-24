// Home: a board of panels. Every panel renders from real data — the page is
// dense because the content is real, not because it is padded.

import { requireUser } from './supabase.js';
import {
  recentFiles, inboxCount, inboxFiles, dashboardStats, deleteFile, getFile,
  listProjectsWithCounts, loadTree, filesByDirectory,
} from './data.js';
import { openCapture, refile, DRAFT_KEY } from './capture.js';
import { renderSidebar, tintOf } from './sidebar.js';

const LAST_PROJECT_KEY = 'pocketbase.lastProject';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  if (mins < 1440) return Math.round(mins / 60) + 'h ago';
  return Math.round(mins / 1440) + 'd ago';
};

const days = (iso) => Math.floor((Date.now() - new Date(iso)) / 86400000);

const excerpt = (body, title) => {
  const rest = String(body ?? '').trim();
  // The title is usually the first line, so drop it or the card says it twice.
  const trimmed = rest.startsWith(title) ? rest.slice(title.length).trim() : rest;
  return trimmed || 'No further detail.';
};

const empty = (mark, headline, note) =>
  '<div class="empty-state"><span class="empty-mark">' + mark + '</span>' +
  '<strong>' + esc(headline) + '</strong><span>' + esc(note) + '</span></div>';

// --- header ------------------------------------------------------------------

function renderHeader() {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  document.querySelector('#greeting').textContent = 'Good ' + part;
  document.querySelector('#today').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

async function renderStats() {
  const s = await dashboardStats();
  document.querySelector('#stats').innerHTML = [
    ['Projects', s.projects], ['Ideas', s.ideas], ['Unfiled', s.unfiled],
  ].map(([label, n]) =>
    '<div class="stat"><div class="stat-num">' + n + '</div>' +
    '<div class="stat-label">' + label + '</div></div>').join('');
}

// --- panels ------------------------------------------------------------------

async function renderInbox() {
  const [count, files] = await Promise.all([inboxCount(), inboxFiles(6)]);
  document.querySelector('#inbox-count').textContent = count;

  document.querySelector('#inbox').innerHTML = files.length
    ? '<div class="row-list">' + files.map((f) =>
        '<div class="row-slot">' +
        '<a class="row-item" href="projects.html#file-' + esc(f.id) + '">' +
        '<span class="row-main"><span class="row-title">' + esc(f.title) + '</span>' +
        '<span class="row-sub">' + esc(f.projects?.name ?? '') + '</span></span>' +
        '<span class="row-time">' + ago(f.updated_at) + '</span></a>' +
        refileButton(f) + '</div>').join('') + '</div>'
    : empty('&#10003;', 'Inbox zero', 'Everything is filed.');
}

// Fetch generously, then show exactly two rows of whatever the window fits.
// The column count is read back from the rendered grid rather than recomputed
// from the minmax(), so it stays correct if the CSS changes.
const RECENT_CAP = 24;

function fillTwoRows() {
  const grid = document.querySelector('#recent .grid-notes');
  if (!grid || !grid.children.length) return;

  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean);
  const max = Math.max(cols.length, 1) * 2;
  [...grid.children].forEach((card, i) => { card.hidden = i >= max; });
}

async function renderRecent() {
  const files = await recentFiles(RECENT_CAP);

  document.querySelector('#recent').innerHTML = files.length
    ? '<div class="grid-notes">' + files.map((f) => {
        const path = [f.projects?.name, f.directories?.name].filter(Boolean).join(' › ');
        // The trash sits beside the link, not inside it: a button nested in an
        // anchor is invalid, and the slot is what positions it over the corner.
        return '<div class="note-slot">' +
          '<a class="card-note" data-tint="' + tintOf(f.project_id) + '" ' +
          'href="projects.html#file-' + esc(f.id) + '">' +
          '<span class="path-chip">' + esc(path) + '</span>' +
          '<span class="card-title">' + esc(f.title) + '</span>' +
          '<span class="excerpt">' + esc(excerpt(f.body, f.title)) + '</span>' +
          '<footer>' + ago(f.updated_at) + '</footer></a>' +
          '<span class="card-tools">' + refileButton(f) +
          '<button class="card-tool card-tool--danger" data-act="delete" ' +
          'data-id="' + esc(f.id) + '" data-title="' + esc(f.title) + '" ' +
          'title="Delete idea" aria-label="Delete ' + esc(f.title) + '">' +
          '&#128465;</button></span></div>';
      }).join('') + '</div>'
    : empty('&#9998;', 'Nothing yet', 'Write the first thing on your mind.');

  fillTwoRows();
}

// The neglect map: which fronts of a project have gone quiet. This is half the
// reason the app exists, and until now nothing surfaced it.
async function renderDust() {
  const host = document.querySelector('#dust');
  const projects = await listProjectsWithCounts();
  if (!projects.length) {
    host.innerHTML = empty('&#9675;', 'No projects yet', 'Create one to track its areas.');
    return;
  }

  const remembered = localStorage.getItem(LAST_PROJECT_KEY);
  const project = projects.find((p) => p.id === remembered) ?? projects[0];

  const [tree, byDir] = await Promise.all([
    loadTree(project.id), filesByDirectory(project.id),
  ]);

  const tops = tree.filter((d) => d.parent_id === null && !d.is_inbox);
  const rows = tops.map((top) => {
    // Walk the whole subtree; an idea three folders down still counts as
    // activity for the area it belongs to.
    const ids = [top.id];
    for (let i = 0; i < ids.length; i++) {
      tree.filter((d) => d.parent_id === ids[i]).forEach((d) => ids.push(d.id));
    }
    const files = ids.flatMap((id) => byDir.get(id) ?? []);
    const newest = files.reduce((max, f) =>
      (!max || f.updated_at > max ? f.updated_at : max), null);
    return { dir: top, count: files.length, idle: newest ? days(newest) : null };
  });

  // An area with no ideas at all is the most neglected thing there is.
  const stale = rows
    .filter((r) => r.idle === null || r.idle >= 14)
    .sort((a, b) => (b.idle ?? 1e6) - (a.idle ?? 1e6))
    .slice(0, 5);

  if (!stale.length) {
    host.innerHTML = empty('&#9728;', 'Nothing stale', 'Every area has had attention lately.');
    return;
  }

  host.innerHTML =
    '<p class="row-sub" style="margin-bottom:var(--s2)">' + esc(project.name) + '</p>' +
    '<div class="row-list">' + stale.map((r) => {
      const idle = r.idle ?? 999;
      const pct = Math.min(idle / 90, 1) * 100;
      return '<a class="row-item" data-tint="' + tintOf(project.id) + '" ' +
        'href="projects.html#dir-' + esc(r.dir.id) + '">' +
        '<span class="row-main"><span class="row-title">' + esc(r.dir.name) + '</span>' +
        '<span class="row-sub">' + (r.count ? r.count + ' ideas' : 'no ideas yet') + '</span>' +
        '<span class="dust-meter"><span class="dust-fill' +
        (idle >= 45 ? ' dust-fill--cold' : '') + '" style="width:' + pct + '%"></span></span>' +
        '</span>' +
        '<span class="row-time">' + (r.idle === null ? '—' : r.idle + 'd') + '</span></a>';
    }).join('') + '</div>';
}

// --- boot --------------------------------------------------------------------

async function refresh() {
  renderHeader();
  await Promise.all([renderStats(), renderInbox(), renderRecent(), renderDust()]);
}

// --- inline capture ----------------------------------------------------------

// The card on Home is the writing surface. Enter behaves like any textarea;
// filing is a deliberate act, either the button or Ctrl+Enter.
function wireCapture() {
  const box = document.querySelector('#capture-input');

  // A textarea will not size itself; without this the card never grows past
  // its first line and long ideas scroll inside a sliver. The floor lives in
  // CSS as min-height, which wins over anything smaller set here.
  const grow = () => {
    box.style.height = 'auto';
    box.style.height = box.scrollHeight + 'px';
  };

  const sync = () => { box.value = localStorage.getItem(DRAFT_KEY) ?? ''; grow(); };

  const focus = () => {
    box.scrollIntoView({ block: 'nearest' });
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  };

  let timer;
  const evolve = () => {
    clearTimeout(timer);
    const body = box.value.trim();
    if (!body) return focus();
    // Hold the draft until the insert lands, so a failed save loses nothing.
    localStorage.setItem(DRAFT_KEY, body);
    openCapture({ body, onClose: async () => { sync(); await refresh(); } });
  };

  sync();

  box.addEventListener('input', () => {
    grow();
    clearTimeout(timer);
    // The only window in which the idea is not yet in the database.
    timer = setTimeout(() => localStorage.setItem(DRAFT_KEY, box.value), 300);
  });

  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); evolve(); }
  });

  return { evolve, focus };
}

// The gear re-opens the filing questions. Both panels use the same button, so
// an idea can be moved from wherever it happens to be on screen.
const refileButton = (f) =>
  '<button class="card-tool" data-act="refile" data-id="' + esc(f.id) + '" ' +
  'title="Move to another folder" aria-label="Move ' + esc(f.title) + '">' +
  '&#9881;</button>';

// One listener per panel, on the panel itself, so it outlives each re-render.
function wireCardTools() {
  const onClick = (e) => {
    const button = e.target.closest('.card-tool');
    if (!button) return;
    e.preventDefault();
    return button.dataset.act === 'delete' ? remove(button) : move(button);
  };
  document.querySelector('#recent').addEventListener('click', onClick);
  document.querySelector('#inbox').addEventListener('click', onClick);
}

async function move(button) {
  button.disabled = true;
  try {
    // Read it fresh: the card was rendered from a list that may be stale.
    refile({ file: await getFile(button.dataset.id), onClose: refresh });
  } catch (err) {
    console.error('could not open that idea', err);
    alert('Could not open that idea. Check your connection and try again.');
  } finally {
    button.disabled = false;
  }
}

// Deleting is the only irreversible thing in the app, so it asks first.
async function remove(button) {
  if (!confirm('Delete "' + button.dataset.title + '"? This cannot be undone.')) return;

  button.disabled = true;
  try {
    await deleteFile(button.dataset.id);
    await refresh();
  } catch (err) {
    console.error('could not delete idea', err);
    button.disabled = false;
    alert('Could not delete. Check your connection and try again.');
  }
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fillTwoRows, 120);
});

async function main() {
  if (!(await requireUser())) return;

  const inline = wireCapture();
  wireCardTools();

  // There is a box on this page already — "New idea" just puts the cursor in it.
  const jot = () => inline.focus();

  document.querySelector('#evolve').addEventListener('click', inline.evolve);
  document.querySelector('#new-idea').addEventListener('click', jot);

  await renderSidebar({ active: 'home', onNewIdea: jot });
  await refresh();
  inline.focus();
}

main();
