(function () {
  const config = window.ROSTER_CONFIG || {};
  const configured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
  let client = null;

  async function getClient() {
    if (!configured) return null;
    if (client) return client;
    const module = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    client = module.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" }
    });
    return client;
  }
  async function rpc(name, body = {}) {
    const supabase = await getClient();
    if (!supabase) return null;
    const { data, error } = await supabase.rpc(name, body);
    if (error) throw error;
    return data;
  }

  window.RosterBackend = {
    configured,
    async session() { const supabase = await getClient(); return supabase ? (await supabase.auth.getSession()).data.session : null; },
    async profile() { return rpc("my_profile"); },
    async signInWithGoogle() {
      const supabase = await getClient();
      if (!supabase) throw new Error("Supabase is not configured yet.");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: config.siteUrl, queryParams: { access_type: "offline", prompt: "consent" } }
      });
      if (error) throw error;
    },
    async signOut() { const supabase = await getClient(); if (supabase) await supabase.auth.signOut(); },
    async loadState() { return rpc("get_roster_state"); },
    async requestIdentity(employeeCode, fullName) { return rpc("request_identity_mapping", { p_employee_code: employeeCode, p_full_name: fullName }); },
    async mappingRequests() { return rpc("get_mapping_requests"); },
    async decideIdentity(requestId, approved) { return rpc("decide_identity_mapping", { p_request_id: requestId, p_approved: approved }); },
    async saveAvailability(employeeCode, month, dates) { return rpc("save_my_availability", { p_employee_code: employeeCode, p_month: month, p_na_dates: dates }); },
    async saveRoster(month, roster) { return rpc("save_roster", { p_month: month, p_roster: roster }); },
    async finalizeRoster(month) { return rpc("finalize_roster", { p_month: month }); },
    async requestSwap(request) { return rpc("create_swap_request", { p_request: request }); },
    async revokeSwap(requestId) { return rpc("revoke_swap_request", { p_request_id: requestId }); },
    async decideSwap(requestId, approved) { return rpc("decide_swap_request", { p_request_id: requestId, p_approved: approved }); },
  };
})();
