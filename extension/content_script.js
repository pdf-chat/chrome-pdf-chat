(async function () {
  const isPdf =
    document.contentType === 'application/pdf' ||
    /\.pdf(\?|#|$)/i.test(location.href);
  if (!isPdf) return;
  if (document.getElementById('__pdf-chat-iframe')) return;

  // Inject iframe — runs as a chrome-extension:// page, fully isolated from the PDF viewer
  const iframe = document.createElement('iframe');
  iframe.id = '__pdf-chat-iframe';
  iframe.src = chrome.runtime.getURL('panel/panel.html');
  Object.assign(iframe.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    width: '340px',
    height: '480px',
    border: 'none',
    zIndex: '2147483647',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    colorScheme: 'normal',
  });
  document.body.appendChild(iframe);

  // Drag state
  let dragging = false, dragStartX, dragStartY, iframeStartRight, iframeStartBottom;

  window.addEventListener('message', (e) => {
    if (e.source !== iframe.contentWindow) return;
    const d = e.data;
    if (d.type === 'TOGGLE_COLLAPSE') {
      iframe.style.height = d.collapsed ? '44px' : '480px';
    }
    if (d.type === 'DRAG_START') {
      dragging = true;
      const rect = iframe.getBoundingClientRect();
      dragStartX = rect.left + d.offsetX;
      dragStartY = rect.top + d.offsetY;
      iframeStartRight = window.innerWidth - rect.right;
      iframeStartBottom = window.innerHeight - rect.bottom;
    }
    if (d.type === 'SCROLL_TO_PAGE') scrollToPage(d.page);
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    iframe.style.right = Math.max(0, iframeStartRight - (e.clientX - dragStartX)) + 'px';
    iframe.style.bottom = Math.max(0, iframeStartBottom - (e.clientY - dragStartY)) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  function post(msg) {
    iframe.contentWindow.postMessage(msg, chrome.runtime.getURL('/'));
  }

  await new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));

  post({ type: 'SET_STATUS', msg: 'Extracting PDF text...' });
  let pages;
  try {
    pages = await extractPdfText(location.href);
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

  post({ type: 'SET_READY', sessionId });
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

function scrollToPage(pageNum) {
  try {
    if (window.PDFViewerApplication) window.PDFViewerApplication.page = pageNum;
  } catch (_) {}
}
