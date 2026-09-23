// The one and only Supabase client. Every other module imports it from here;
// nothing instantiates its own.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

// Every page except login calls this first.
export async function requireUser() {
  const user = await currentUser();
  if (!user) {
    window.location.replace('login.html');
    return null;
  }
  return user;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.replace('login.html');
}
