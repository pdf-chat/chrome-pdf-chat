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

refreshSignedInState();

// Web Application OAuth client ID (created in Google Cloud Console → Web application type).
// The Chrome Extension client type in manifest.json is for chrome.identity.getAuthToken only.
const GOOGLE_WEB_CLIENT_ID = '51684954923-7moq37e4fff9hpc23i0d8ooqv8q7ffm6.apps.googleusercontent.com';

document.getElementById('google-btn').addEventListener('click', async () => {
  showStatus('Opening Google sign-in...');

  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org`;
  const nonce = crypto.randomUUID();
  const nonceBytes = new TextEncoder().encode(nonce);
  const nonceHash = await crypto.subtle.digest('SHA-256', nonceBytes);
  const hashedNonce = Array.from(new Uint8Array(nonceHash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_WEB_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'id_token');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('nonce', hashedNonce);

  chrome.identity.launchWebAuthFlow(
    { url: authUrl.href, interactive: true },
    async (redirectedTo) => {
      if (chrome.runtime.lastError || !redirectedTo) {
        showStatus('Error: ' + (chrome.runtime.lastError?.message || 'No response.'), true);
        return;
      }
      try {
        const hash = new URL(redirectedTo).hash.slice(1);
        const params = new URLSearchParams(hash);
        const idToken = params.get('id_token');
        if (!idToken) throw new Error('No ID token in callback URL.');

        showStatus('Signing in...');
        const { data, error } = await client.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
          nonce,
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
