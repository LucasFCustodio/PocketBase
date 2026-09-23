// Projects: one board whose contents change as you drill down. At the root it
// shows the projects; inside one it shows that level's folders and ideas.
//
// Behaviour is unchanged from the previous version — click a folder to descend,
// click an idea to open it, climb back out with the breadcrumb.

import { requireUser } from './supabase.js';
import {
  listProjectsWithCounts, createProject, createDirectory, loadTree, getFile,
  filesByDirectory, directoryPath,
} from './data.js';
import { openCapture, openFile } from './capture.js';
import { renderSidebar, tintOf } from './sidebar.js';

const LAST_PROJECT_KEY = 'pocketbase.lastProject';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return Math.max(mins, 1) + 'm ago';
  if (mins < 1440) return Math.round(mins / 60) + 'h ago';
  return Math.round(mins / 1440) + 'd ago';
};

const onDate = (iso) => new Date(iso).toLocaleDateString(undefined, {
  day: 'numeric', month: 'short', year: 'numeric',
});

const excerpt = (body, title) => {
  const rest = String(body ?? '').trim();
  const trimmed = rest.startsWith(title) ? rest.slice(title.length).trim() : rest;
  return trimmed || 'No further detail.';
};

let projects = [];
let projectId = null;
let tree = [];
let filesByDir = new Map();
let currentDirId = null; // null = the project's own level

const $ = (sel) => document.querySelector(sel);

// --- modal -------------------------------------------------------------------

function askFor(title, placeholder) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML =
      '<div class="modal-card">' +
      '<h2 class="modal-title">' + esc(title) + '</h2>' +
      '<input class="modal-input" id="modal-name" placeholder="' + esc(placeholder) + '" autocomplete="off" />' +
      '<div class="modal-actions">' +
      '<button class="btn btn--secondary" id="modal-cancel">Cancel</button>' +
      '<button class="btn btn--primary" id="modal-create" disabled>Create</button>' +
      '</div></div>';
    document.body.appendChild(modal);

    const input = modal.querySelector('#modal-name');
    const create = modal.querySelector('#modal-create');
    input.focus();

    const done = (v) => { modal.remove(); resolve(v); };
    input.addEventListener('input', () => { create.disabled = !input.value.trim(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) done(input.value.trim());
      if (e.key === 'Escape') done(null);
    });
    create.addEventListener('click', () => done(input.value.trim() || null));
    modal.querySelector('#modal-cancel').addEventListener('click', () => done(null));
    modal.addEventListener('click', (e) => { if (e.target === modal) done(null); });
  });
}

// --- card builders -----------------------------------------------------------

// Up to three child names inside a folder card: a free "peek inside" that both
// fills the card and tells you whether descending is worth it.
function peek(names) {
  if (!names.length) return '';
  return '<span class="card-peek">' +
    names.slice(0, 3).map((n) => '<span>' + esc(n) + '</span>').join('') +
    '</span>';
}

function summarise(folders, docs) {
  if (!folders && !docs) return 'Empty';
  const bits = [];
  if (folders) bits.push(folders + (folders === 1 ? ' folder' : ' folders'));
  if (docs) bits.push(docs + (docs === 1 ? ' idea' : ' ideas'));
  return bits.join(' · ');
}

function noteCard(f, tint) {
  const text = excerpt(f.body, f.title);
  return '<button class="card-note' + (text.length > 220 ? ' card-note--tall' : '') +
    '" data-tint="' + tint + '" data-id="' + esc(f.id) + '">' +
    '<span class="card-title">' + esc(f.title) + '</span>' +
    '<span class="excerpt">' + esc(text) + '</span>' +
    '<footer>' + ago(f.updated_at) + '</footer></button>';
}

const newTile = (id, label) =>
  '<button class="tile-new" id="' + id + '"><span class="plus">+</span>' + esc(label) + '</button>';

// --- root: all projects ------------------------------------------------------

function renderProjectBoard() {
  $('#projects-section').hidden = false;
  $('#folders-section').hidden = true;
  $('#docs-section').hidden = true;

  $('#board-title').textContent = 'Projects';
  $('#board-meta').textContent =
    projects.length + (projects.length === 1 ? ' project' : ' projects');
  $('#crumbs').innerHTML = '';
  $('#new-folder').hidden = true;
  $('#projects-count').textContent = projects.length;

  $('#projects').innerHTML = projects.map((p) =>
    '<button class="card-board" data-tint="' + tintOf(p.id) + '" data-id="' + esc(p.id) + '">' +
    '<span class="icon-tile">&#9635;</span>' +
    '<span class="card-title">' + esc(p.name) + '</span>' +
    '<span class="card-meta">' + p.fileCount + (p.fileCount === 1 ? ' idea' : ' ideas') + '</span>' +
    '<span class="card-peek"><span>Created ' + esc(onDate(p.created_at)) + '</span></span>' +
    '</button>').join('') + newTile('new-project', 'New project');

  $('#projects').querySelectorAll('.card-board').forEach((c) => {
    c.addEventListener('click', () => select(c.dataset.id));
  });
  $('#new-project').addEventListener('click', addProject);
}

// --- inside a project --------------------------------------------------------

function renderLevel() {
  $('#projects-section').hidden = true;
  $('#folders-section').hidden = false;
  $('#docs-section').hidden = false;
  $('#new-folder').hidden = false;

  const project = projects.find((p) => p.id === projectId);
  const tint = tintOf(projectId);
  const path = directoryPath(tree, currentDirId);
  const here = path[path.length - 1];

  const folders = tree.filter((d) => d.parent_id === currentDirId);
  const docs = filesByDir.get(currentDirId ?? 'none') ?? [];

  $('#board-title').textContent = here ? here.name : (project?.name ?? 'Project');
  const newest = docs.reduce((m, f) => (!m || f.updated_at > m ? f.updated_at : m), null);
  $('#board-meta').textContent =
    [summarise(folders.length, docs.length), newest ? 'updated ' + ago(newest) : null]
      .filter(Boolean).join(' · ');

  const crumbs = [
    '<button class="crumb" data-to="root">Projects</button>',
    '<button class="crumb" data-to="">' + esc(project?.name ?? 'Project') + '</button>',
  ];
  path.forEach((d, i) => {
    crumbs.push(i === path.length - 1
      ? '<span class="crumb current">' + esc(d.name) + '</span>'
      : '<button class="crumb" data-to="' + esc(d.id) + '">' + esc(d.name) + '</button>');
  });
  $('#crumbs').innerHTML = crumbs.join('<span class="crumb-sep">&rsaquo;</span>');
  $('#crumbs').querySelectorAll('.crumb[data-to]').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.to === 'root') return showRoot();
      currentDirId = b.dataset.to || null;
      renderLevel();
    });
  });

  $('#folders-count').textContent = folders.length;
  $('#folders').innerHTML = folders.map((d) => {
    const subs = tree.filter((k) => k.parent_id === d.id);
    const mine = filesByDir.get(d.id) ?? [];
    const names = subs.map((k) => k.name).concat(mine.map((f) => f.title));
    return '<button class="card-board" data-tint="' + tint + '" data-id="' + esc(d.id) + '">' +
      '<span class="icon-tile">' + (d.is_inbox ? '&#9993;' : '&#9636;') + '</span>' +
      '<span class="card-title">' + esc(d.name) + '</span>' +
      '<span class="card-meta">' + summarise(subs.length, mine.length) + '</span>' +
      peek(names) + '</button>';
  }).join('') + newTile('new-folder-tile', 'New folder');

  $('#folders').querySelectorAll('.card-board').forEach((c) => {
    c.addEventListener('click', () => { currentDirId = c.dataset.id; renderLevel(); });
  });
  $('#new-folder-tile').addEventListener('click', addFolder);

  // Files with no directory sit at the project's own level, which also catches
  // any orphaned by a deleted folder so nothing becomes unreachable.
  $('#docs-count').textContent = docs.length;
  $('#documents').innerHTML =
    docs.map((f) => noteCard(f, tint)).join('') + newTile('new-doc-tile', 'New idea');

  $('#documents').querySelectorAll('.card-note').forEach((c) => {
    c.addEventListener('click', () => open(c.dataset.id));
  });
  $('#new-doc-tile').addEventListener('click', capture);
}

// --- actions -----------------------------------------------------------------

function showRoot() {
  projectId = null;
  currentDirId = null;
  renderProjectBoard();
}

async function select(id, dirId = null) {
  projectId = id;
  currentDirId = dirId;
  localStorage.setItem(LAST_PROJECT_KEY, id);
  const [t, f] = await Promise.all([loadTree(id), filesByDirectory(id)]);
  tree = t;
  filesByDir = f;
  renderLevel();
}

async function addProject() {
  const name = await askFor('New project', 'e.g. DollarSeeds');
  if (!name) return;
  const id = await createProject(name);
  projects = await listProjectsWithCounts();
  await select(id);
}

async function addFolder() {
  const name = await askFor('New folder', 'e.g. Recurring Transactions');
  if (!name) return;
  await createDirectory({ projectId, parentId: currentDirId, name });
  tree = await loadTree(projectId);
  renderLevel();
}

async function open(fileId) {
  const file = await getFile(fileId);
  openFile({ file, projects, tree, onClose: refresh });
}

const capture = () => openCapture({ onClose: refresh });

async function refresh() {
  projects = await listProjectsWithCounts();
  if (!projectId) return renderProjectBoard();
  filesByDir = await filesByDirectory(projectId);
  renderLevel();
}

// --- boot --------------------------------------------------------------------

async function main() {
  if (!(await requireUser())) return;

  $('#new-idea').addEventListener('click', capture);
  $('#new-folder').addEventListener('click', addFolder);

  await renderSidebar({ active: 'projects', onNewIdea: capture });
  projects = await listProjectsWithCounts();

  if (!projects.length) return renderProjectBoard();

  // Deep links from Home and the sidebar: #file-<id>, #dir-<id>, #inbox.
  const hash = window.location.hash;
  const remembered = localStorage.getItem(LAST_PROJECT_KEY);
  const fallback = projects.some((p) => p.id === remembered) ? remembered : null;

  if (hash.startsWith('#file-')) {
    const file = await getFile(hash.slice(6));
    await select(file.project_id, file.directory_id);
    return open(file.id);
  }

  if (hash.startsWith('#dir-')) {
    const dirId = hash.slice(5);
    for (const p of projects) {
      const t = await loadTree(p.id);
      if (t.some((d) => d.id === dirId)) return select(p.id, dirId);
    }
  }

  if (hash === '#inbox' && fallback) {
    const t = await loadTree(fallback);
    return select(fallback, t.find((d) => d.is_inbox)?.id ?? null);
  }

  renderProjectBoard();
}

main();
