chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'API_REQUEST') return;
  handleApiRequest(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ __error: err.message }));
  return true; // keep channel open for async response
});

async function handleApiRequest({ endpoint, method = 'POST', body }) {
  const storage = await chrome.storage.local.get([
    'access_token', 'refresh_token', 'backend_url', 'supabase_url',
  ]);
  const backendUrl = (storage.backend_url || 'http://localhost:8000').replace(/\/$/, '');
  let token = storage.access_token;

  let resp = await fetchWithAuth(backendUrl + endpoint, method, body, token);

  if (resp.status === 401 && storage.refresh_token && storage.supabase_url) {
    const newToken = await refreshToken(storage.supabase_url, storage.refresh_token);
    if (newToken) {
      token = newToken;
      resp = await fetchWithAuth(backendUrl + endpoint, method, body, token);
    } else {
      throw new Error('Session expired. Please log in again in extension settings.');
    }
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `Server error ${resp.status}`);
  }
  return resp.json();
}

async function fetchWithAuth(url, method, body, token) {
  return fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function refreshToken(supabaseUrl, refreshToken) {
  try {
    const resp = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    await chrome.storage.local.set({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    return data.access_token;
  } catch {
    return null;
  }
}
