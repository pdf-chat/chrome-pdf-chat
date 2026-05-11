// TODO: Replace with your production backend URL before publishing.
const BACKEND_URL = 'https://pdf-chat-backend-production.up.railway.app';
// TODO: Replace with your Supabase publishable key (same value as in options.js).
// Find it in: Supabase dashboard → Settings → API → Publishable key (sb_publishable_...)
const SUPABASE_URL = 'https://wbhintapmmtbbzedawsr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_xhQsh8XWuPbrkjSYTcP-og_JT0zhwMp';

// Track which tabs have loaded a PDF response, so the content script can find PDFs
// that aren't on the current URL (e.g. IEEE's stamp.jsp serves HTML and loads the PDF
// in a nested iframe — only the network layer can reliably see it).
const tabPdfs = new Map(); // tabId -> { url, timestamp }

chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const ct = (details.responseHeaders || []).find(
      (h) => h.name.toLowerCase() === 'content-type'
    );
    if (ct && ct.value && /application\/pdf/i.test(ct.value)) {
      tabPdfs.set(details.tabId, { url: details.url, timestamp: Date.now() });
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.tabs.onRemoved.addListener((tabId) => tabPdfs.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  // Drop stale entries when tab navigates somewhere new; webRequest will repopulate
  // if the new page also serves a PDF
  if (info.url) tabPdfs.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PDF_URL') {
    const tabId = sender.tab && sender.tab.id;
    const entry = tabId !== undefined ? tabPdfs.get(tabId) : null;
    sendResponse(entry ? { url: entry.url } : null);
    return; // synchronous
  }
  if (message.type === 'FETCH_PDF') {
    fetchPdfAsBase64(message.url)
      .then(sendResponse)
      .catch((err) => sendResponse({ __error: err.message }));
    return true;
  }
  if (message.type !== 'API_REQUEST') return;
  handleApiRequest(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ __error: err.message }));
  return true; // keep channel open for async response
});

async function fetchPdfAsBase64(url) {
  // credentials:'include' sends the user's cookies for the target domain — required for
  // PDFs behind cookie-based auth (EZproxy, Shibboleth, paywalls). Works because the
  // extension has <all_urls> host permission.
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { base64: btoa(binary) };
}

async function handleApiRequest({ endpoint, method = 'POST', body }) {
  const storage = await chrome.storage.local.get(['access_token', 'refresh_token']);
  let token = storage.access_token;

  let resp = await fetchWithAuth(BACKEND_URL + endpoint, method, body, token);

  if (resp.status === 401 && storage.refresh_token) {
    const newToken = await refreshToken(storage.refresh_token);
    if (newToken) {
      token = newToken;
      resp = await fetchWithAuth(BACKEND_URL + endpoint, method, body, token);
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

async function refreshToken(refreshToken) {
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_PUBLISHABLE_KEY,
        },
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
