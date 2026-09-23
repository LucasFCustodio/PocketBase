// Supabase connection details.
//
// The anon key is designed to be public — it is what the browser authenticates
// with, and row level security is what actually protects the data. It is safe
// in this file and safe in git.
//
// The service_role key is NOT. It bypasses RLS entirely. It must never appear
// in any file under js/, only in server-side environment variables.

export const SUPABASE_URL = 'https://pltfodixzvupoqmpnixd.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsdGZvZGl4enZ1cG9xbXBuaXhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMDY2MzIsImV4cCI6MjEwNTY4MjYzMn0.ot0l_zzPBKfRB2113fWQanpLh-i7lsy-UGxCeykLH84';
