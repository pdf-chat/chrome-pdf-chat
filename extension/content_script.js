(async function () {
  const pdfUrl = await findPdfUrl();
  if (!pdfUrl) return;
  if (document.getElementById('__pdf-chat-iframe')) return;

  // Inject iframe — runs as a chrome-extension:// page, fully isolated from the PDF viewer
  const iframe = document.createElement('iframe');
  iframe.id = '__pdf-chat-iframe';
  iframe.src = chrome.runtime.getURL('panel/panel.html');
  Object.assign(iframe.style, {
    position: 'fixed',
    top: '0',
    bottom: '0',
    right: '0',
    width: '340px',
    border: 'none',
    zIndex: '2147483647',
    boxShadow: '-4px 0 16px rgba(0,0,0,0.4)',
    colorScheme: 'normal',
  });
  document.body.appendChild(iframe);

  window.addEventListener('message', (e) => {
    if (e.source !== iframe.contentWindow) return;
    const d = e.data;
    if (d.type === 'TOGGLE_COLLAPSE') {
      iframe.style.top = d.collapsed ? 'auto' : '0';
      iframe.style.height = d.collapsed ? '44px' : '';
    }
    if (d.type === 'SCROLL_TO_PAGE') {
      scrollToPage(d.page);
    }
  });

  function post(msg) {
    iframe.contentWindow.postMessage(msg, chrome.runtime.getURL('/'));
  }

  await new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));

  post({ type: 'SET_STATUS', msg: 'Extracting PDF text...' });
  let pages;
  try {
    pages = await extractPdfText(pdfUrl);
  } catch (err) {
    post({ type: 'SET_ERROR', msg: 'Could not read PDF: ' + err.message });
    return;
  }

  if (!pages.length) {
    post({ type: 'SET_ERROR', msg: "This PDF couldn't be read — it may be encrypted or image-only." });
    return;
  }

  post({ type: 'SET_STATUS', msg: 'Uploading to server...' });
  let sessionId;
  try {
    const result = await apiRequest('/session/upload', { pages });
    sessionId = result.session_id;
  } catch (err) {
    post({ type: 'SET_ERROR', msg: 'Upload failed: ' + err.message });
    return;
  }

  post({ type: 'SET_READY', sessionId, pages });
})();

async function extractPdfText(url) {
  const { base64 } = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'FETCH_PDF', url }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (response && response.__error) return reject(new Error(response.__error));
      resolve(response);
    });
  });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.js');
  const pdf = await pdfjsLib.getDocument({ data: bytes.buffer }).promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(' ').trim();
    if (text) pages.push({ page: i, text });
  }
  return pages;
}

function localPdfUrl() {
  if (document.contentType === 'application/pdf') return location.href;
  if (/\.pdf(\?|#|$)/i.test(location.href)) return location.href;
  // Chrome's built-in PDF viewer always injects an <embed> with one of these MIME types
  if (document.querySelector(
    'embed[type="application/pdf"], embed[type="application/x-google-chrome-pdf"]'
  )) return location.href;
  return null;
}

function askServiceWorkerForPdf() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_PDF_URL' }, (response) => {
      // Ignore lastError — service worker may not be ready yet
      void chrome.runtime.lastError;
      resolve(response && response.url ? response.url : null);
    });
  });
}

// Detect PDF via local DOM signals OR by asking the service worker which tracks
// network responses with Content-Type: application/pdf. The latter catches PDFs
// loaded inside iframes or via JS (IEEE stamp.jsp, similar publisher endpoints).
async function findPdfUrl() {
  for (let i = 0; i < 16; i++) {
    const local = localPdfUrl();
    if (local) return local;
    const fromSw = await askServiceWorkerForPdf();
    if (fromSw) return fromSw;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

function scrollToPage(pageNum) {
  // Timestamp suffix forces a fresh hashchange even when clicking the same page badge twice
  location.hash = 'page=' + pageNum + '&_=' + Date.now();
}

function apiRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'API_REQUEST', endpoint, method: 'POST', body },
      (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.__error) return reject(new Error(response.__error));
        resolve(response);
      }
    );
  });
}

