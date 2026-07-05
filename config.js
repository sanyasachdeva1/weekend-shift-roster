// Copy the public values from Supabase Project Settings > API.
// The anon key is intentionally public and is safe only with the included RLS policies.
// Never place the service-role key in this file.
window.ROSTER_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  siteUrl: window.location.origin + window.location.pathname,
};
