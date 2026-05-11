// TODO: Replace with your Supabase publishable key.
// Find it in: Supabase dashboard → Settings → API → Publishable key (sb_publishable_...)
const SUPABASE_URL = 'https://wbhintapmmtbbzedawsr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_xhQsh8XWuPbrkjSYTcP-og_JT0zhwMp';

const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const statusEl = document.getElementById('status');
const authView = document.getElementById('auth-view');
const signedInView = document.getElementById('signed-in-view');
const signedInEmail = document.getElementById('signed-in-email');
let isSignUp = false;

function showStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'err' : 'ok';
}

async function refreshSignedInState() {
  const { access_token } = await chrome.storage.local.get('access_token');
  if (access_token) {
    // Decode email from JWT payload (no verification needed here — display only)
    try {
      const payload = JSON.parse(atob(access_token.split('.')[1]));
      signedInEmail.textContent = '✓ Signed in as ' + (payload.email || payload.sub);
    } catch {
      signedInEmail.textContent = '✓ Signed in';
    }
    signedInView.style.display = '';
    authView.style.display = 'none';
  } else {
    signedInView.style.display = 'none';
    authView.style.display = '';
  }
}

chrome.storage.local.get('model').then(({ model }) => {
  if (model) document.getElementById('model').value = model;
});

refreshSignedInState();

document.getElementById('tab-signin').addEventListener('click', () => {
  isSignUp = false;
  document.getElementById('tab-signin').classList.add('active');
  document.getElementById('tab-signup').classList.remove('active');
  document.getElementById('auth-btn').textContent = 'Sign In';
  document.getElementById('password').autocomplete = 'current-password';
});

document.getElementById('tab-signup').addEventListener('click', () => {
  isSignUp = true;
  document.getElementById('tab-signup').classList.add('active');
  document.getElementById('tab-signin').classList.remove('active');
  document.getElementById('auth-btn').textContent = 'Create Account';
  document.getElementById('password').autocomplete = 'new-password';
});

document.getElementById('auth-btn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) { showStatus('Enter email and password.', true); return; }

  showStatus(isSignUp ? 'Creating account...' : 'Signing in...');
  try {
    let data, error;
    if (isSignUp) {
      ({ data, error } = await client.auth.signUp({ email, password }));
      if (!error && data.user && !data.session) {
        showStatus('Check your email to confirm your account, then sign in.', false);
        return;
      }
    } else {
      ({ data, error } = await client.auth.signInWithPassword({ email, password }));
    }
    if (error) throw error;
    await chrome.storage.local.set({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    showStatus('');
    refreshSignedInState();
  } catch (err) {
    showStatus('Error: ' + err.message, true);
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['access_token', 'refresh_token']);
  showStatus('Signed out.');
  refreshSignedInState();
});

document.getElementById('save-btn').addEventListener('click', async () => {
  const model = document.getElementById('model').value;
  await chrome.storage.local.set({ model });
  showStatus('✓ Saved.');
});
