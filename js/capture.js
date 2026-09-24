// The capture flow: write -> project -> scope -> sub-scope -> open.
//
// The one rule that shapes everything here: the file is INSERTed the moment the
// user leaves the writing step, before a single categorisation question is
// asked. Every tap after that is an UPDATE. Abandoning the flow at any point
// therefore still captures the idea, which is the whole reason the app exists.

import {
  listProjects, createProject, loadTree, childrenOf, inboxOf, directoryPath,
  createDirectory, createFile, updateFile, deriveTitle,
} from './data.js';

export const DRAFT_KEY = 'pocketbase.draft';
const LAST_PROJECT_KEY = 'pocketbase.lastProject';
const MAX_CHIP_ROWS = 3; // the wizard never drills deeper than this

let el = null;   // overlay root
let state = null;
let onClose = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- lifecycle --------------------------------------------------------------

export function openCapture(options = {}) {
  onClose = options.onClose ?? null;
  state = {
    step: 'write',
    file: null,
    projects: [],
    projectId: null,
    tree: [],
    row: 0,         // which directory level the chips are showing
    parentId: null, // parent whose children are on screen
  };

  mount();

  // Handed text, there is nothing left to type: save it and open on the first
  // question. Home works this way — its card is the writing surface, so the
  // overlay must never show a second box on top of it.
  if (options.body) return startFiling(options.body);

  renderWrite();

  // Load what the next step needs while the user is still typing, so that
  // "Clarify it" never waits on the network.
  prefetch();
}

async function startFiling(body) {
  state.step = 'saving';
  inner().innerHTML = '<h2 class="question">Saving&hellip;</h2>';
  try {
    state.projects = await listProjects();
    state.projectId = pickActiveProject(state.projects);
    if (!state.projectId) {
      state.projectId = await createProject('My First Project');
      state.projects = await listProjects();
    }
    state.tree = await loadTree(state.projectId);

    state.file = await createFile({
      projectId: state.projectId,
      directoryId: inboxOf(state.tree)?.id ?? null,
      body,
    });
    localStorage.removeItem(DRAFT_KEY);
    renderProjectStep();
  } catch (err) {
    console.error('could not save idea', err);
    inner().innerHTML = '';
    showError('Could not save. Check your connection and try again.');
  }
}

// Re-ask the filing questions for an idea that already exists. Same chips as
// capture, but the row is there from the start so every answer is an update.
export async function refile({ file, onClose: cb }) {
  onClose = cb ?? null;
  state = {
    step: 'project',
    file,
    projects: [],
    projectId: file.project_id,
    tree: [],
    row: 0,
    parentId: null,
  };

  mount();
  inner().innerHTML = '<h2 class="question">Loading&hellip;</h2>';
  try {
    state.projects = await listProjects();
    state.tree = await loadTree(state.projectId);
    renderProjectStep();
  } catch (err) {
    console.error('could not load the filing questions', err);
    inner().innerHTML = '';
    showError('Could not load your projects. Check your connection and try again.');
  }
}

// Open an existing file straight into the editor, skipping the wizard. Used by
// the Projects page so there is only ever one file editor in the app.
export function openFile({ file, projects, tree, onClose: cb }) {
  onClose = cb ?? null;
  state = {
    step: 'open',
    file,
    projects,
    projectId: file.project_id,
    tree,
    row: 0,
    parentId: file.directory_id,
  };
  mount();
  renderOpen();
}

async function prefetch() {
  try {
    state.projects = await listProjects();
    state.projectId = pickActiveProject(state.projects);
    if (state.projectId) state.tree = await loadTree(state.projectId);
  } catch (err) {
    console.error('capture prefetch failed', err);
  }
}

function pickActiveProject(projects) {
  if (!projects.length) return null;
  const remembered = localStorage.getItem(LAST_PROJECT_KEY);
  return projects.some((p) => p.id === remembered) ? remembered : projects[0].id;
}

function mount() {
  el = document.createElement('div');
  el.className = 'capture';
  el.innerHTML = '<div class="capture-inner"></div>';
  document.body.appendChild(el);
  document.body.classList.add('capture-open');
  document.addEventListener('keydown', onKeydown);
}

function closeCapture() {
  // Flush any debounced edit before the DOM goes away, otherwise closing within
  // the autosave window silently drops the last thing the user typed.
  try { state?.flush?.(); } catch (err) { console.error(err); }

  document.removeEventListener('keydown', onKeydown);
  el?.remove();
  el = null;
  document.body.classList.remove('capture-open');
  const cb = onClose;
  state = null;
  onClose = null;
  cb?.();
}

const inner = () => el.querySelector('.capture-inner');

// --- step 1: write ----------------------------------------------------------

function renderWrite() {
  state.step = 'write';
  inner().innerHTML = [
    '<label class="sr-only" for="idea">Your idea</label>',
    '<textarea id="idea" class="idea" placeholder="What\'s the idea?"></textarea>',
    '<div class="capture-actions">',
    '  <span class="hint">Ctrl + Enter</span>',
    '  <button class="btn btn--primary" id="clarify" disabled>Clarify it</button>',
    '</div>',
  ].join('');

  const box = inner().querySelector('#idea');
  const button = inner().querySelector('#clarify');

  box.value = localStorage.getItem(DRAFT_KEY) ?? '';
  button.disabled = !box.value.trim();
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);

  let timer;
  box.addEventListener('input', () => {
    button.disabled = !box.value.trim();
    clearTimeout(timer);
    // The only window in which the idea is not yet in the database.
    timer = setTimeout(() => localStorage.setItem(DRAFT_KEY, box.value), 300);
  });

  button.addEventListener('click', clarify);
}

async function clarify() {
  const body = inner().querySelector('#idea')?.value.trim();
  if (!body || state.file) return;

  const button = inner().querySelector('#clarify');
  if (button) { button.disabled = true; button.textContent = 'Saving…'; }

  try {
    if (!state.projectId) {
      state.projectId = await createProject('My First Project');
      state.projects = await listProjects();
      state.tree = await loadTree(state.projectId);
    }
    if (!state.tree.length) state.tree = await loadTree(state.projectId);

    state.file = await createFile({
      projectId: state.projectId,
      directoryId: inboxOf(state.tree)?.id ?? null,
      body,
    });
    localStorage.removeItem(DRAFT_KEY);
    renderProjectStep();
  } catch (err) {
    console.error('could not save idea', err);
    if (button) { button.disabled = false; button.textContent = 'Clarify it'; }
    showError('Could not save. Check your connection and try again.');
  }
}

// --- step 2: project --------------------------------------------------------

function renderProjectStep() {
  state.step = 'project';
  renderChips({
    question: 'Which project?',
    chips: state.projects.map((p) => ({ id: p.id, name: p.name })),
    newLabel: '+ New project…',
    onPick: pickProject,
    onNew: async (name) => {
      const id = await createProject(name);
      state.projects = await listProjects();
      await pickProject(id);
    },
  });
}

async function pickProject(projectId) {
  if (projectId !== state.projectId) {
    state.projectId = projectId;
    state.tree = await loadTree(projectId);
    state.file = await updateFile(state.file.id, {
      project_id: projectId,
      directory_id: inboxOf(state.tree)?.id ?? null,
    });
  }
  localStorage.setItem(LAST_PROJECT_KEY, projectId);
  state.row = 0;
  state.parentId = null;
  renderDirectoryStep();
}

// --- steps 3-5: scope, sub-scope, and one optional level deeper -------------

function renderDirectoryStep() {
  state.step = 'directory';
  const options = childrenOf(state.tree, state.parentId);

  // Nothing left to ask, or we have hit the cap. The row was updated on the way
  // in, so the idea is already where it belongs — close instead of reopening
  // the text the user just wrote.
  if (!options.length || state.row >= MAX_CHIP_ROWS) return closeCapture();

  renderChips({
    question: state.row === 0 ? 'Which part of the project?' : 'Anywhere more specific?',
    chips: options.map((d) => ({ id: d.id, name: d.name })),
    newLabel: '+ New…',
    canFileHere: state.row > 0,
    onPick: pickDirectory,
    onNew: async (name) => {
      const dir = await createDirectory({
        projectId: state.projectId,
        parentId: state.parentId,
        name,
      });
      state.tree.push(dir);
      await pickDirectory(dir.id);
    },
  });
}

async function pickDirectory(directoryId) {
  state.file = await updateFile(state.file.id, { directory_id: directoryId });
  state.parentId = directoryId;
  state.row += 1;
  renderDirectoryStep();
}

// --- chip rendering ---------------------------------------------------------

function renderChips({ question, chips, newLabel, onPick, onNew, canFileHere = false }) {
  state.chips = chips;
  state.onPick = onPick;

  const chipHtml = chips.map((c, i) =>
    '<button class="chip" data-id="' + esc(c.id) + '">' +
    '<span class="num">' + (i + 1) + '</span>' + esc(c.name) + '</button>').join('');

  inner().innerHTML = [
    breadcrumb(),
    '<h2 class="question">' + esc(question) + '</h2>',
    '<div class="chips">',
    chipHtml,
    '<button class="chip chip-new" id="chip-new">' + esc(newLabel) + '</button>',
    '</div>',
    '<div class="capture-actions">',
    '<span class="hint">' + (canFileHere ? 'Esc to stop here' : 'Esc saves to Inbox') + '</span>',
    canFileHere ? '<button class="btn btn--secondary" id="file-here">File it here</button>' : '',
    '</div>',
  ].join('');

  inner().querySelectorAll('.chip[data-id]').forEach((b) => {
    b.addEventListener('click', () => guard(() => onPick(b.dataset.id)));
  });
  inner().querySelector('#file-here')?.addEventListener('click', closeCapture);
  inner().querySelector('#chip-new').addEventListener('click', () => promptNew(newLabel, onNew));
}

function promptNew(label, onNew) {
  const row = inner().querySelector('.chips');
  row.innerHTML = '<input class="new-name" placeholder="' + esc(label.replace(/^\+ /, '')) + '" />';
  const input = row.querySelector('.new-name');
  input.focus();
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && input.value.trim()) guard(() => onNew(input.value.trim()));
    if (e.key === 'Escape') state.step === 'project' ? renderProjectStep() : renderDirectoryStep();
  });
}

function breadcrumb() {
  const project = state.projects.find((p) => p.id === state.projectId);
  const parts = [project?.name].filter(Boolean).concat(
    directoryPath(state.tree, state.file?.directory_id)
      .filter((d) => !d.is_inbox)
      .map((d) => d.name));
  if (!parts.length) return '';
  return '<nav class="capture-crumb">' + parts.map(esc).join(' <span>&rsaquo;</span> ') + '</nav>';
}

// --- final step: the file, open ---------------------------------------------

function renderOpen() {
  state.step = 'open';
  const f = state.file;

  inner().innerHTML = [
    breadcrumb(),
    '<input class="file-title" id="title" value="' + esc(f.title) + '" />',
    '<textarea class="idea" id="body">' + esc(f.body) + '</textarea>',
    '<div class="capture-actions">',
    '  <span class="hint" id="saved">Saved</span>',
    '  <button class="btn btn--primary" id="done">Done</button>',
    '</div>',
  ].join('');

  const title = inner().querySelector('#title');
  const body = inner().querySelector('#body');
  const flag = inner().querySelector('#saved');
  body.focus();
  body.setSelectionRange(body.value.length, body.value.length);

  let timer;
  let dirty = false;

  const save = async () => {
    dirty = false;
    try {
      state.file = await updateFile(f.id, {
        title: title.value.trim() || deriveTitle(body.value),
        body: body.value,
      });
      flag.textContent = 'Saved';
    } catch {
      flag.textContent = 'Not saved';
    }
  };

  const autosave = () => {
    dirty = true;
    clearTimeout(timer);
    flag.textContent = 'Saving…';
    timer = setTimeout(save, 500);
  };

  // Called by closeCapture while the inputs still exist.
  state.flush = () => {
    clearTimeout(timer);
    if (dirty) save();
  };

  title.addEventListener('input', autosave);
  body.addEventListener('input', autosave);
  inner().querySelector('#done').addEventListener('click', closeCapture);
}

// --- keyboard ---------------------------------------------------------------

function onKeydown(e) {
  if (!state) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    // Esc means "good enough, stop asking" — never "discard". By this point the
    // row already exists, so there is nothing to lose and nothing to confirm.
    if (state.step === 'write') return saveDraftAndClose();
    return closeCapture();
  }

  if (state.step === 'write') {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); clarify(); }
    return;
  }

  if (state.step !== 'directory' && state.step !== 'project') return;
  if (e.target.matches('input, textarea')) return;

  if (e.key === 'Backspace') { e.preventDefault(); return stepBack(); }

  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= (state.chips?.length ?? 0)) {
    e.preventDefault();
    guard(() => state.onPick(state.chips[n - 1].id));
  }
}

function stepBack() {
  if (state.step === 'project') return; // the file is already saved; nothing behind this
  if (state.row === 0) return renderProjectStep();

  state.row -= 1;
  const path = directoryPath(state.tree, state.parentId);
  const target = path[state.row - 1] ?? null;
  state.parentId = target?.id ?? null;

  guard(async () => {
    state.file = await updateFile(state.file.id, {
      directory_id: target?.id ?? inboxOf(state.tree)?.id ?? null,
    });
    renderDirectoryStep();
  });
}

function saveDraftAndClose() {
  const box = inner().querySelector('#idea');
  if (box?.value.trim()) localStorage.setItem(DRAFT_KEY, box.value);
  closeCapture();
}

// --- helpers ----------------------------------------------------------------

function guard(fn) {
  Promise.resolve()
    .then(fn)
    .catch((err) => {
      console.error(err);
      showError('Something went wrong. Your idea is saved.');
    });
}

function showError(message) {
  let box = inner().querySelector('.capture-error');
  if (!box) {
    box = document.createElement('p');
    box.className = 'capture-error';
    inner().appendChild(box);
  }
  box.textContent = message;
}
