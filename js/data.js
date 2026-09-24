// All database access lives here. No DOM code.

import { supabase, currentUser } from './supabase.js';

// Derive a title from the body so capture never has to ask for one — a title
// prompt would be the slowest step in the flow. Stored, not computed at read
// time, so the user can edit it independently afterwards.
export function deriveTitle(body) {
  const text = (body ?? '').trim();
  if (!text) return 'Untitled idea';

  const firstLine = text.split('\n')[0].trim();
  if (firstLine && firstLine.length <= 60) return firstLine;

  const head = text.slice(0, 50);
  const cut = head.lastIndexOf(' ');
  return (cut > 20 ? head.slice(0, cut) : head) + '…';
}

export async function listProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

// Projects with their file counts, in one query. PostgREST returns the count as
// an embedded aggregate, so the Projects page does not need a query per card.
export async function listProjectsWithCounts() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, created_at, files(count)')
    .order('created_at', { ascending: true });
  if (error) throw error;

  return data.map((p) => ({
    id: p.id,
    name: p.name,
    created_at: p.created_at,
    fileCount: p.files?.[0]?.count ?? 0,
  }));
}

export async function createProject(name) {
  const { data, error } = await supabase.rpc('create_project', { p_name: name });
  if (error) throw error;
  return data; // the new project's id
}

// One query for the whole tree. Trees are tens of rows, so every wizard step
// afterwards is a client-side filter with zero network latency.
export async function loadTree(projectId) {
  const { data, error } = await supabase
    .from('directories')
    .select('id, parent_id, name, sort_order, is_inbox')
    .eq('project_id', projectId)
    .order('sort_order');
  if (error) throw error;
  return data;
}

export function childrenOf(tree, parentId) {
  return tree.filter((d) => d.parent_id === parentId && !d.is_inbox);
}

export function inboxOf(tree) {
  return tree.find((d) => d.is_inbox) ?? null;
}

export function directoryPath(tree, directoryId) {
  const byId = new Map(tree.map((d) => [d.id, d]));
  const path = [];
  let node = byId.get(directoryId);
  while (node) {
    path.unshift(node);
    node = node.parent_id ? byId.get(node.parent_id) : null;
  }
  return path;
}

export async function createDirectory({ projectId, parentId, name }) {
  const user = await currentUser();

  // .is() only accepts null/true/false, so the null case needs its own filter.
  let q = supabase
    .from('directories')
    .select('sort_order')
    .eq('project_id', projectId);
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);

  const siblings = await q.order('sort_order', { ascending: false }).limit(1);
  const nextOrder = (siblings.data?.[0]?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from('directories')
    .insert({
      user_id: user.id,
      project_id: projectId,
      parent_id: parentId,
      name: name.trim(),
      sort_order: nextOrder,
    })
    .select('id, parent_id, name, sort_order, is_inbox')
    .single();
  if (error) throw error;
  return data;
}

export async function createFile({ projectId, directoryId, body }) {
  const user = await currentUser();
  const { data, error } = await supabase
    .from('files')
    .insert({
      user_id: user.id,
      project_id: projectId,
      directory_id: directoryId,
      title: deriveTitle(body),
      body,
    })
    .select('id, project_id, directory_id, title, body')
    .single();
  if (error) throw error;
  return data;
}

export async function updateFile(id, patch) {
  const { data, error } = await supabase
    .from('files')
    .update(patch)
    .eq('id', id)
    .select('id, project_id, directory_id, title, body')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteFile(id) {
  const { error } = await supabase.from('files').delete().eq('id', id);
  if (error) throw error;
}

export async function recentFiles(limit = 6) {
  const { data, error } = await supabase
    .from('files')
    .select('id, title, body, updated_at, project_id, directory_id, projects(name), directories(name)')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function inboxCount() {
  const { data: inboxes, error: e1 } = await supabase
    .from('directories')
    .select('id')
    .eq('is_inbox', true);
  if (e1) throw e1;
  if (!inboxes.length) return 0;

  // Orphans (directory_id null, left behind by a deleted directory) count as
  // unfiled too, otherwise they are invisible everywhere.
  const ids = inboxes.map((d) => d.id);
  const { count, error: e2 } = await supabase
    .from('files')
    .select('id', { count: 'exact', head: true })
    .or('directory_id.in.(' + ids.join(',') + '),directory_id.is.null');
  if (e2) throw e2;
  return count ?? 0;
}

// One query for every file in the project, grouped by directory. The tree view
// renders from this — a query per directory would be ~25 round trips on load.
export async function filesByDirectory(projectId) {
  const { data, error } = await supabase
    .from('files')
    .select('id, title, body, directory_id, updated_at')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const grouped = new Map();
  for (const file of data) {
    const key = file.directory_id ?? 'none';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(file);
  }
  return grouped;
}

export async function getFile(id) {
  const { data, error } = await supabase
    .from('files')
    .select('id, project_id, directory_id, title, body')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

// The rows behind inboxCount(): unfiled ideas, newest first. Same .or() filter,
// so files orphaned by a deleted directory stay visible here too.
export async function inboxFiles(limit = 6) {
  const { data: inboxes, error: e1 } = await supabase
    .from('directories')
    .select('id')
    .eq('is_inbox', true);
  if (e1) throw e1;

  const ids = inboxes.map((d) => d.id);
  const filter = ids.length
    ? 'directory_id.in.(' + ids.join(',') + '),directory_id.is.null'
    : 'directory_id.is.null';

  const { data, error } = await supabase
    .from('files')
    .select('id, title, body, updated_at, projects(name)')
    .or(filter)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// Three numbers for the stat strip. Counts only — no rows come back.
export async function dashboardStats() {
  const count = async (table, build = (q) => q) => {
    const { count: n, error } = await build(
      supabase.from(table).select('id', { count: 'exact', head: true }));
    if (error) throw error;
    return n ?? 0;
  };

  const [projects, ideas, unfiled] = await Promise.all([
    count('projects'),
    count('files'),
    inboxCount(),
  ]);
  return { projects, ideas, unfiled };
}
