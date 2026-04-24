const statusEl = document.getElementById('status');

function showStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'err' : 'ok';
}

// Restore saved values
chrome.storage.local.get(
  ['supabase_url', 'supabase_anon_key', 'backend_url', 'model', 'access_token']
).then((data) => {
  if (data.supabase_url) document.getElementById('supabase-url').value = data.supabase_url;
  if (data.supabase_anon_key) document.getElementById('supabase-anon-key').value = data.supabase_anon_key;
  if (data.backend_url) document.getElementById('backend-url').value = data.backend_url;
  if (data.model) document.getElementById('model').value = data.model;
  if (data.access_token) showStatus('✓ Currently signed in');
});

document.getElementById('login-btn').addEventListener('click', async () => {
  const supabaseUrl = document.getElementById('supabase-url').value.trim();
  const anonKey = document.getElementById('supabase-anon-key').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!supabaseUrl || !anonKey) {
    showStatus('Enter Supabase URL and Anon Key first.', true);
    return;
  }
  showStatus('Signing in...');

  try {
    await chrome.storage.local.set({ supabase_url: supabaseUrl, supabase_anon_key: anonKey });
    const { createClient } = supabase;
    const client = createClient(supabaseUrl, anonKey);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await chrome.storage.local.set({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    showStatus('✓ Signed in as ' + data.user.email);
  } catch (err) {
    showStatus('Error: ' + err.message, true);
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['access_token', 'refresh_token']);
  showStatus('Signed out.');
});

document.getElementById('save-btn').addEventListener('click', async () => {
  const model = document.getElementById('model').value;
  const backendUrl = document.getElementById('backend-url').value.trim() || 'http://localhost:8000';
  await chrome.storage.local.set({ model, backend_url: backendUrl });
  showStatus('✓ Settings saved.');
});
