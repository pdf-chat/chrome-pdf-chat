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

  const redirectTo = `https://${chrome.runtime.id}.chromiumapp.org`;

  // Get the Supabase-managed OAuth URL — Supabase handles talking to Google,
  // so we never hit Google's deprecated implicit flow directly.
  const { data, error: urlError } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (urlError || !data?.url) {
    showStatus('Error: ' + (urlError?.message || 'Could not get auth URL.'), true);
    return;
  }

  chrome.identity.launchWebAuthFlow(
    { url: data.url, interactive: true },
    async (redirectedTo) => {
      if (chrome.runtime.lastError || !redirectedTo) {
        showStatus('Error: ' + (chrome.runtime.lastError?.message || 'No response.'), true);
        return;
      }
      try {
        // Supabase returns the session in the URL fragment: #access_token=...&refresh_token=...
        const hash = new URL(redirectedTo).hash.slice(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        if (!accessToken) throw new Error('No access token in callback URL.');

        await chrome.storage.local.set({ access_token: accessToken, refresh_token: refreshToken });
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
