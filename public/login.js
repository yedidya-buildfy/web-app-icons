document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabase === 'undefined') return;
  const client = window.supabaseAuthClient || supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function safeRedirectPath() {
    const params = new URLSearchParams(location.search);
    const raw = params.get('redirect') || '/generate.html';
    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin) return '/generate.html';
      if (!url.pathname.startsWith('/')) return '/generate.html';
      return url.pathname + url.search + url.hash;
    } catch { return '/generate.html'; }
  }
  function redirectAfterAuth(){ window.location.assign(safeRedirectPath()); }
  function show(el, on){ if (el) el.style.display = on ? 'block' : 'none'; }

  const tabLogin = document.getElementById('tabLogin');
  const tabSignup = document.getElementById('tabSignup');
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const toLoginBtn = document.getElementById('toLoginBtn');
  const forgotBtn = document.getElementById('forgotBtn');
  const googleBtn = document.getElementById('googleBtn');
  const githubBtn = document.getElementById('githubBtn');

  if (tabLogin && tabSignup && loginForm && signupForm) {
    tabLogin.addEventListener('click', () => { tabLogin.classList.add('active'); tabSignup.classList.remove('active'); show(loginForm,true); show(signupForm,false); });
    tabSignup.addEventListener('click', () => { tabSignup.classList.add('active'); tabLogin.classList.remove('active'); show(loginForm,false); show(signupForm,true); });
    if (toLoginBtn) toLoginBtn.addEventListener('click', () => { tabLogin.click(); });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const active = (signupForm && signupForm.style.display !== 'none') ? signupForm : loginForm;
      if (active && e.target && e.target.tagName === 'INPUT') e.preventDefault();
    }
  });

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (document.getElementById('loginEmail') || {}).value?.trim();
      const password = (document.getElementById('loginPassword') || {}).value;
      const errEl = document.getElementById('loginErr'); const msgEl = document.getElementById('loginMsg'); show(errEl,false); show(msgEl,false);
      try {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) { if (errEl) { errEl.textContent = error.message; show(errEl,true);} return; }
        redirectAfterAuth();
      } catch (err) { if (errEl) { errEl.textContent = 'Login failed'; show(errEl,true);} }
    });
  }

  if (forgotBtn) forgotBtn.addEventListener('click', () => { window.location.assign('/reset-password.html'); });

  // OAuth button handlers
  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      try {
        await window.signInWithGoogle();
      } catch (err) {
        console.error('Google OAuth failed:', err);
        const errEl = document.getElementById('loginErr');
        if (errEl) { errEl.textContent = 'Google sign-in failed. Please try again.'; show(errEl,true); }
      }
    });
  }

  if (githubBtn) {
    githubBtn.addEventListener('click', async () => {
      try {
        await window.signInWithGitHub();
      } catch (err) {
        console.error('GitHub OAuth failed:', err);
        const errEl = document.getElementById('loginErr');
        if (errEl) { errEl.textContent = 'GitHub sign-in failed. Please try again.'; show(errEl,true); }
      }
    });
  }

  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (document.getElementById('signupEmail') || {}).value?.trim();
      const password = (document.getElementById('signupPassword') || {}).value;
      const confirm = (document.getElementById('signupConfirm') || {}).value;
      const errEl = document.getElementById('signupErr'); const msgEl = document.getElementById('signupMsg'); show(errEl,false); show(msgEl,false);
      if (!password || password.length < 8) { if (errEl) { errEl.textContent = 'Password must be at least 8 characters.'; show(errEl,true);} return; }
      if (password !== confirm) { if (errEl) { errEl.textContent = 'Passwords do not match.'; show(errEl,true);} return; }
      try {
        const { error } = await client.auth.signUp({ email, password });
        if (error) { if (errEl) { errEl.textContent = error.message; show(errEl,true);} return; }
        if (msgEl) { msgEl.textContent = 'Account created. Check your email to confirm (if required), then log in.'; show(msgEl,true);} 
        if (tabLogin) tabLogin.click();
      } catch (err) { if (errEl) { errEl.textContent = 'Sign up failed'; show(errEl,true);} }
    });
  }

  (async function redirectIfAuthed(){
    try { const { data: { session } } = await client.auth.getSession(); if (session) redirectAfterAuth(); } catch {}
  })();
});
