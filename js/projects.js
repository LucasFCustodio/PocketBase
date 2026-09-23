// Projects: a horizontal rail of project cards, and the tree of what is inside
// the selected one. This is the retrieval half of the app — unlike capture,
// browsing to any depth is fine here.

import { requireUser, signOut } from './supabase.js';
import {
  listProjectsWithCounts, createProject, loadTree, getFile, filesByDirectory,
  directoryPath,
} from './data.js';
import { openFile } from './capture.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LAST_PROJECT_KEY = 'pocketbase.lastProject';

let projects = [];
let projectId = null;
let tree = [];
let filesByDir = new Map();
let currentDirId = null; // null = the project's own level

const created = (iso) => new Date(iso).toLocaleDateString(undefined, {
  day: 'numeric', month: 'short', year: 'numeric',
});

// --- the rail ---------------------------------------------------------------

function renderRail() {
  const rail = document.querySelector('#rail');

  rail.innerHTML = projects.map((p) =>
    '<button class="project-card' + (p.id === projectId ? ' active' : '') +
    '" data-id="' + esc(p.id) + '">' +
    '<span class="project-name">' + esc(p.name) + '</span>' +
    '<span class="project-count">' + p.fileCount +
    (p.fileCount === 1 ? ' file' : ' files') + '</span>' +
    '<span class="project-date">Created ' + esc(created(p.created_at)) + '</span>' +
    '</button>').join('') +
  '<button class="project-card card-new" id="new-project">' +
  '<span class="plus">+</span><span class="project-name">New project</span></button>';

  rail.querySelectorAll('.project-card[data-id]').forEach((card) => {
    card.addEventListener('click', () => select(card.dataset.id));
  });
  rail.querySelector('#new-project').addEventListener('click', addProject);
}

// Click-and-drag to scroll an overflowing strip sideways. Used by the project
// rail and by the tree, which gets wide quickly.
//
// Deliberately no setPointerCapture: capturing retargets the follow-up click to
// the rail itself, so card clicks never fire. Tracking on window instead keeps
// the drag working outside the rail while leaving clicks alone.
function enableDragScroll(rail) {
  if (!rail) return;
  let dragging = false;
  let startX = 0;
  let startScroll = 0;
  let travelled = 0;

  rail.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragging = true;
    travelled = 0;
    startX = e.clientX;
    startScroll = rail.scrollLeft;
  });

  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    travelled = Math.max(travelled, Math.abs(dx));
    if (travelled > 3) {
      rail.classList.add('dragging');
      rail.scrollLeft = startScroll - dx;
    }
  });

  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    rail.classList.remove('dragging');
  });

  // A drag that ends on a card must not also open that project.
  rail.addEventListener('click', (e) => {
    if (travelled > 5) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}

// --- new project ------------------------------------------------------------

function askForProjectName() {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML =
      '<div class="modal-card">' +
      '<h2 class="modal-title">New project</h2>' +
      '<input class="modal-input" id="project-name" placeholder="e.g. DollarSeeds" ' +
      'autocomplete="off" />' +
      '<div class="modal-actions">' +
      '<button class="ghost" id="modal-cancel">Cancel</button>' +
      '<button class="primary" id="modal-create" disabled>Create</button>' +
      '</div></div>';

    document.body.appendChild(modal);

    const input = modal.querySelector('#project-name');
    const create = modal.querySelector('#modal-create');
    input.focus();

    const done = (value) => { modal.remove(); resolve(value); };

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

async function addProject() {
  const name = await askForProjectName();
  if (!name) return;

  const id = await createProject(name);
  projects = await listProjectsWithCounts();
  await select(id);
}

// --- browsing one level at a time -------------------------------------------
//
// Two rows: the folders inside the current level, then the documents inside it.
// Clicking a folder descends; the breadcrumb climbs back out. One level at a
// time keeps the page the same height no matter how deep the tree goes.

async function select(id) {
  projectId = id;
  currentDirId = null;
  localStorage.setItem(LAST_PROJECT_KEY, id);
  tree = await loadTree(id);
  renderRail();
  await loadLevel();
}

async function loadLevel() {
  filesByDir = await filesByDirectory(projectId);
  renderLevel();
}

function renderLevel() {
  renderCrumbs();
  renderFolders();
  renderDocuments();
}

function renderCrumbs() {
  const project = projects.find((p) => p.id === projectId);
  const path = directoryPath(tree, currentDirId);

  const parts = ['<button class="crumb" data-id="">' +
    esc(project?.name ?? 'Project') + '</button>'];

  path.forEach((d, i) => {
    const last = i === path.length - 1;
    parts.push(last
      ? '<span class="crumb current">' + esc(d.name) + '</span>'
      : '<button class="crumb" data-id="' + esc(d.id) + '">' + esc(d.name) + '</button>');
  });

  const crumbs = document.querySelector('#crumbs');
  crumbs.innerHTML = parts.join('<span class="crumb-sep">&rsaquo;</span>');
  crumbs.querySelectorAll('.crumb[data-id]').forEach((b) => {
    b.addEventListener('click', () => {
      currentDirId = b.dataset.id || null;
      renderLevel();
    });
  });
}

function renderFolders() {
  const row = document.querySelector('#folders');
  const folders = tree.filter((d) => d.parent_id === currentDirId);

  if (!folders.length) {
    row.innerHTML = '<p class="row-empty">No folders here.</p>';
    return;
  }

  row.innerHTML = folders.map((d) => {
    const subs = tree.filter((k) => k.parent_id === d.id).length;
    const docs = (filesByDir.get(d.id) ?? []).length;
    return '<button class="folder-card' + (d.is_inbox ? ' inbox' : '') +
      '" data-id="' + esc(d.id) + '">' +
      '<span class="card-title">' + esc(d.name) + '</span>' +
      '<span class="card-meta">' + summarise(subs, docs) + '</span>' +
      '</button>';
  }).join('');

  row.querySelectorAll('.folder-card').forEach((card) => {
    card.addEventListener('click', () => {
      currentDirId = card.dataset.id;
      renderLevel();
    });
  });
}

function summarise(folders, docs) {
  if (!folders && !docs) return 'Empty';
  const bits = [];
  if (folders) bits.push(folders + (folders === 1 ? ' folder' : ' folders'));
  if (docs) bits.push(docs + (docs === 1 ? ' doc' : ' docs'));
  return bits.join(' &middot; ');
}

function renderDocuments() {
  const row = document.querySelector('#documents');
  // Files sitting at the project's own level have no directory. That also
  // catches any orphaned by a deleted folder, so nothing becomes unreachable.
  const docs = filesByDir.get(currentDirId ?? 'none') ?? [];

  if (!docs.length) {
    row.innerHTML = '<p class="row-empty">No documents here.</p>';
    return;
  }

  row.innerHTML = docs.map((f) =>
    '<button class="doc-card" data-id="' + esc(f.id) + '">' +
    '<span class="card-title">' + esc(f.title) + '</span>' +
    '<span class="card-meta">' + esc(created(f.updated_at)) + '</span>' +
    '</button>').join('');

  row.querySelectorAll('.doc-card').forEach((card) => {
    card.addEventListener('click', () => open(card.dataset.id));
  });
}

async function open(fileId) {
  const file = await getFile(fileId);
  openFile({ file, projects, tree, onClose: refresh });
}

// File counts on the cards go stale as soon as an idea is edited or moved.
async function refresh() {
  projects = await listProjectsWithCounts();
  renderRail();
  await loadLevel();
}

// --- boot -------------------------------------------------------------------

async function main() {
  if (!(await requireUser())) return;

  document.querySelector('#signout').addEventListener('click', signOut);
  enableDragScroll(document.querySelector('#rail'));

  projects = await listProjectsWithCounts();
  if (!projects.length) {
    renderRail();
    document.querySelector('#folders').innerHTML =
      '<p class="row-empty">No projects yet.</p>';
    return;
  }

  const remembered = localStorage.getItem(LAST_PROJECT_KEY);
  await select(projects.some((p) => p.id === remembered) ? remembered : projects[0].id);

  // Home links here with #file-<id>.
  const hash = window.location.hash;
  if (hash.startsWith('#file-')) open(hash.slice(6));
}

main();
