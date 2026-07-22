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
    async session() { return configured ? { user: { id: "open-team-form" } } : null; },
    async profile() { return { role: "employee", employee_code: null, full_name: "Open team form" }; },
    async signInWithGoogle() {
      throw new Error("Google sign-in is disabled for this roster.");
    },
    async signOut() {},
    async loadState() { return rpc("open_get_roster_state"); },
    async requestIdentity(employeeCode, fullName) { return rpc("request_identity_mapping", { p_employee_code: employeeCode, p_full_name: fullName }); },
    async mappingRequests() { return rpc("get_mapping_requests"); },
    async decideIdentity(requestId, approved) { return rpc("decide_identity_mapping", { p_request_id: requestId, p_approved: approved }); },
    async saveAvailability(employeeCode, month, dates) { return rpc("open_save_availability", { p_employee_code: employeeCode, p_month: month, p_na_dates: dates }); },
    async saveRoster(month, roster) { return rpc("open_save_roster", { p_month: month, p_roster: roster, p_actor_name: roster.generatedBy || "Roster admin" }); },
    async finalizeRoster(month, actorName = "Roster admin") { return rpc("open_finalize_roster", { p_month: month, p_actor_name: actorName }); },
    async requestSwap(request) { return rpc("open_create_swap_request", { p_request: request }); },
    async decideColleagueSwap(requestId, approved, colleagueCode) { return rpc("open_decide_colleague_swap_request", { p_request_id: requestId, p_colleague_code: colleagueCode, p_approved: approved }); },
    async revokeSwap(requestId, requesterCode) { return rpc("open_revoke_swap_request", { p_request_id: requestId, p_requester_code: requesterCode }); },
    async decideSwap(requestId, approved) { return rpc("decide_swap_request", { p_request_id: requestId, p_approved: approved }); },
  };
})();
