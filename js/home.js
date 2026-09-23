// Home: the + comes first, then the Inbox nudge, then what you last worked on.

import { requireUser, signOut } from './supabase.js';
import { recentFiles, inboxCount } from './data.js';
import { openCapture } from './capture.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  if (mins < 1440) return Math.round(mins / 60) + 'h ago';
  return Math.round(mins / 1440) + 'd ago';
};

async function render() {
  const inbox = document.querySelector('#inbox');
  const list = document.querySelector('#recent');

  try {
    const [count, files] = await Promise.all([inboxCount(), recentFiles(3)]);

    // Without this nudge the Inbox silently becomes a junk drawer and the
    // "which areas am I neglecting" signal goes blank.
    inbox.innerHTML = count
      ? '<a href="projects.html#inbox">' + count + ' unfiled ' +
        (count === 1 ? 'idea' : 'ideas') + ' &rsaquo; sort them</a>'
      : '';

    list.innerHTML = files.length
      ? files.map((f) =>
          '<li><a href="projects.html#file-' + esc(f.id) + '">' +
          '<span class="file-name">' + esc(f.title) + '</span>' +
          '<span class="file-meta">' + esc(f.projects?.name ?? '') +
          ' &middot; ' + ago(f.updated_at) + '</span></a></li>').join('')
      : '<li class="empty">Nothing yet. Hit + and write the first thing on your mind.</li>';
  } catch (err) {
    console.error(err);
    list.innerHTML = '<li class="empty">Could not load your ideas.</li>';
  }
}

async function main() {
  if (!(await requireUser())) return;

  document.querySelector('#new-idea')
    .addEventListener('click', () => openCapture({ onClose: render }));
  document.querySelector('#signout').addEventListener('click', signOut);

  render();
}

main();
