// Home: a board of panels. Every panel renders from real data — the page is
// dense because the content is real, not because it is padded.

import { requireUser } from './supabase.js';
import {
  recentFiles, inboxCount, inboxFiles, dashboardStats,
  listProjectsWithCounts, loadTree, filesByDirectory,
} from './data.js';
import { openCapture } from './capture.js';
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
    ['Projects', s.projects], ['Folders', s.folders],
    ['Ideas', s.ideas], ['Unfiled', s.unfiled],
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
        '<a class="row-item" href="projects.html#file-' + esc(f.id) + '">' +
        '<span class="row-main"><span class="row-title">' + esc(f.title) + '</span>' +
        '<span class="row-sub">' + esc(f.projects?.name ?? '') + '</span></span>' +
        '<span class="row-time">' + ago(f.updated_at) + '</span></a>').join('') + '</div>'
    : empty('&#10003;', 'Inbox zero', 'Everything is filed.');
}

async function renderRecent() {
  const files = await recentFiles(6);

  document.querySelector('#recent').innerHTML = files.length
    ? '<div class="grid-notes">' + files.map((f) => {
        const path = [f.projects?.name, f.directories?.name].filter(Boolean).join(' › ');
        return '<a class="card-note" data-tint="' + tintOf(f.project_id) + '" ' +
          'href="projects.html#file-' + esc(f.id) + '">' +
          '<span class="path-chip">' + esc(path) + '</span>' +
          '<span class="card-title">' + esc(f.title) + '</span>' +
          '<span class="excerpt">' + esc(excerpt(f.body, f.title)) + '</span>' +
          '<footer>' + ago(f.updated_at) + '</footer></a>';
      }).join('') + '</div>'
    : empty('&#9998;', 'Nothing yet', 'Write the first thing on your mind.');
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

async function main() {
  if (!(await requireUser())) return;

  const capture = () => openCapture({ onClose: refresh });
  document.querySelector('#new-idea').addEventListener('click', capture);
  document.querySelector('#capture-card').addEventListener('click', capture);

  await renderSidebar({ active: 'home', onNewIdea: capture });
  await refresh();
}

main();
