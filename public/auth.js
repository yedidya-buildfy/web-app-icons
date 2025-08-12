// Shared Supabase Auth Helpers
// Loads after SUPABASE_URL and SUPABASE_ANON_KEY are present via env.js and supabase-js CDN
(function () {
  if (typeof supabase === 'undefined') {
    console.warn('Supabase JS not loaded. Include the CDN script before auth.js');
    return;
  }
  if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined') {
    console.warn('Supabase env not found. Ensure public/env.js defines SUPABASE_URL and SUPABASE_ANON_KEY');
    return;
  }

  // Create or reuse a global client
  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.supabaseAuthClient = client;

  async function renderAuthNav() {
    const container = document.getElementById('authNav');
    if (!container) return;
    const { data: { session } } = await client.auth.getSession();
    if (session) {
      const user = session.user;
      const displayName = user.user_metadata?.full_name || user.email || 'User';
      container.innerHTML = `
        <span class="user-info" style="margin-right: 10px;">Hello, ${displayName}</span>
        <button id="logoutBtn" class="nav-link" style="border:none;background:transparent;cursor:pointer">Logout</button>
      `;
      const btn = document.getElementById('logoutBtn');
      if (btn) btn.addEventListener('click', async () => {
        await client.auth.signOut();
        const current = new URL(window.location.href);
        // After logout send to login
        window.location.href = '/login.html?redirect=' + encodeURIComponent(current.pathname);
      });
    } else {
      container.innerHTML = '<a href="/login.html" class="nav-link">Login</a>';
    }
  }

  async function requireAuth() {
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      const redirect = encodeURIComponent(window.location.pathname);
      window.location.href = `/login.html?redirect=${redirect}`;
    }
  }

  // Auto-enforce auth on pages unless they opt-out with <body data-auth-optional="true">
  document.addEventListener('DOMContentLoaded', async () => {
    const optional = document.body && document.body.getAttribute('data-auth-optional') === 'true';
    if (!optional) await requireAuth();
    renderAuthNav();
  });

  // OAuth Sign In Functions
  async function signInWithGoogle() {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/callback'
      }
    });
    if (error) {
      console.error('Google OAuth error:', error);
      throw error;
    }
    return data;
  }

  async function signInWithGitHub() {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: window.location.origin + '/auth/callback'
      }
    });
    if (error) {
      console.error('GitHub OAuth error:', error);
      throw error;
    }
    return data;
  }

  // Expose helpers
  window.renderAuthNav = renderAuthNav;
  window.requireAuth = requireAuth;
  window.signInWithGoogle = signInWithGoogle;
  window.signInWithGitHub = signInWithGitHub;

  // Re-render on auth changes
  client.auth.onAuthStateChange((_event, _session) => {
    renderAuthNav();
  });
})();
