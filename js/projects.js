// Projects: a horizontal rail of project cards, and the tree of what is inside
// the selected one. This is the retrieval half of the app — unlike capture,
// browsing to any depth is fine here.

import { requireUser, signOut } from './supabase.js';
import {
  listProjectsWithCounts, createProject, loadTree, getFile, filesByDirectory,
} from './data.js';
import { openFile } from './capture.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LAST_PROJECT_KEY = 'pocketbase.lastProject';

let projects = [];
let projectId = null;
let tree = [];

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

// --- the tree ---------------------------------------------------------------

async function select(id) {
  projectId = id;
  localStorage.setItem(LAST_PROJECT_KEY, id);
  tree = await loadTree(id);
  renderRail();
  await renderTree();
}

async function renderTree() {
  const root = document.querySelector('#tree');
  const files = await filesByDirectory(projectId);

  const inbox = tree.find((d) => d.is_inbox);
  const tops = tree.filter((d) => d.parent_id === null && !d.is_inbox);

  // A file whose directory was deleted has directory_id null. It must still be
  // reachable — an idea that exists but cannot be seen is the one outcome this
  // app is built to prevent. Show it alongside the unfiled ones.
  const orphans = files.get('none') ?? [];
  if (orphans.length && inbox) {
    files.set(inbox.id, (files.get(inbox.id) ?? []).concat(orphans));
  }

  const project = projects.find((p) => p.id === projectId);
  const branches = (inbox ? [inbox] : []).concat(tops);

  // The project is the root of the chart; everything hangs off it.
  root.innerHTML =
    '<ul><li>' +
    '<span class="box root">' + esc(project?.name ?? 'Project') + '</span>' +
    (branches.length
      ? '<ul>' + branches.map((b) => branchHtml(b, files)).join('') + '</ul>'
      : '') +
    '</li></ul>';

  root.querySelectorAll('.box.file').forEach((box) => {
    box.addEventListener('click', () => open(box.dataset.id));
  });
}

// One directory and everything under it. Files come before sub-directories so
// that the ideas actually filed here read first.
function branchHtml(node, files) {
  const kids = tree.filter((d) => d.parent_id === node.id);
  const mine = files.get(node.id) ?? [];

  const children = mine
    .map((f) => '<li><button class="box file" data-id="' + esc(f.id) + '" title="' +
      esc(f.title) + '">' + esc(f.title) + '</button></li>')
    .concat(kids.map((kid) => branchHtml(kid, files)));

  return '<li>' +
    '<span class="box dir' + (node.is_inbox ? ' inbox' : '') + '">' +
    esc(node.name) + '</span>' +
    (children.length ? '<ul>' + children.join('') + '</ul>' : '') +
    '</li>';
}

async function open(fileId) {
  const file = await getFile(fileId);
  openFile({ file, projects, tree, onClose: refresh });
}

// File counts on the cards go stale as soon as an idea is edited or moved.
async function refresh() {
  projects = await listProjectsWithCounts();
  renderRail();
  await renderTree();
}

// --- boot -------------------------------------------------------------------

async function main() {
  if (!(await requireUser())) return;

  document.querySelector('#signout').addEventListener('click', signOut);
  enableDragScroll(document.querySelector('#rail'));
  enableDragScroll(document.querySelector('#tree-scroll'));

  projects = await listProjectsWithCounts();
  if (!projects.length) {
    renderRail();
    document.querySelector('#tree').innerHTML =
      '<p class="empty">No projects yet.</p>';
    return;
  }

  const remembered = localStorage.getItem(LAST_PROJECT_KEY);
  await select(projects.some((p) => p.id === remembered) ? remembered : projects[0].id);

  // Home links here with #file-<id>.
  const hash = window.location.hash;
  if (hash.startsWith('#file-')) open(hash.slice(6));
}

main();
