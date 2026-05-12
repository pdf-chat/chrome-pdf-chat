const SUPABASE_URL = 'https://wbhintapmmtbbzedawsr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_xhQsh8XWuPbrkjSYTcP-og_JT0zhwMp';

const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const statusEl = document.getElementById('status');
const authView = document.getElementById('auth-view');
const signedInView = document.getElementById('signed-in-view');
const signedInEmailEl = document.getElementById('signed-in-email');

function showStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'err' : 'ok';
}

async function refreshSignedInState() {
  const { access_token } = await chrome.storage.local.get('access_token');
  if (access_token) {
    try {
      const payload = JSON.parse(atob(access_token.split('.')[1]));
      signedInEmailEl.textContent = '✓ ' + (payload.email || 'Signed in');
    } catch {
      signedInEmailEl.textContent = '✓ Signed in';
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

document.getElementById('google-btn').addEventListener('click', async () => {
  showStatus('Opening Google sign-in...');

  const manifest = chrome.runtime.getManifest();
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
  authUrl.searchParams.set('client_id', manifest.oauth2.client_id);
  authUrl.searchParams.set('response_type', 'id_token');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', manifest.oauth2.scopes.join(' '));
  authUrl.searchParams.set('nonce', crypto.randomUUID());

  chrome.identity.launchWebAuthFlow(
    { url: authUrl.href, interactive: true },
    async (redirectedTo) => {
      if (chrome.runtime.lastError || !redirectedTo) {
        showStatus('Sign-in cancelled or failed.', true);
        return;
      }
      try {
        // Google returns tokens in the URL fragment after the redirect
        const hash = new URL(redirectedTo).hash.slice(1);
        const params = new URLSearchParams(hash);
        const idToken = params.get('id_token');
        if (!idToken) throw new Error('No ID token returned from Google.');

        showStatus('Signing in...');
        const { data, error } = await client.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });
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
    }
  );
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await client.auth.signOut().catch(() => {});
  await chrome.storage.local.remove(['access_token', 'refresh_token']);
  showStatus('Signed out.');
  refreshSignedInState();
});

document.getElementById('save-btn').addEventListener('click', async () => {
  const model = document.getElementById('model').value;
  await chrome.storage.local.set({ model });
  showStatus('✓ Saved.');
});
