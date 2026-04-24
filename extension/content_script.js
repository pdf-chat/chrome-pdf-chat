(async function () {
  const isPdf =
    document.contentType === 'application/pdf' ||
    /\.pdf(\?|#|$)/i.test(location.href);
  if (!isPdf) return;
  if (document.getElementById('__pdf-chat-host')) return;

  const panel = await injectPanel();

  panel.setStatus('Extracting PDF text...');
  let pages;
  try {
    pages = await extractPdfText(location.href);
  } catch (err) {
    panel.setError('Could not read PDF: ' + err.message);
    return;
  }

  if (!pages.length) {
    panel.setError('This PDF couldn\'t be read — it may be encrypted or image-only.');
    return;
  }

  panel.setStatus('Uploading to server...');
  let sessionId;
  try {
    const result = await apiRequest('/session/upload', { pages });
    sessionId = result.session_id;
  } catch (err) {
    panel.setError('Upload failed: ' + err.message, true);
    return;
  }

  panel.setReady(sessionId);

  async function sendQuestion(question, sessionId) {
    const { model } = await chrome.storage.local.get('model');
    return apiRequest('/session/query', {
      session_id: sessionId,
      question,
      model: model || 'gpt-4o',
    });
  }

  panel.onSend(async (question) => {
    try {
      return await sendQuestion(question, sessionId);
    } catch (err) {
      throw new Error(err.message || 'Request failed');
    }
  });
})();

async function extractPdfText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();

  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.js');
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

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

async function injectPanel() {
  const host = document.createElement('div');
  host.id = '__pdf-chat-host';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const [htmlText, cssText] = await Promise.all([
    fetch(chrome.runtime.getURL('panel/panel.html')).then((r) => r.text()),
    fetch(chrome.runtime.getURL('panel/panel.css')).then((r) => r.text()),
  ]);

  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = htmlText;
  shadow.appendChild(wrapper);

  const panelEl = shadow.getElementById('pdf-chat-panel');
  const statusEl = shadow.getElementById('pdf-chat-status');
  const messagesEl = shadow.getElementById('pdf-chat-messages');
  const inputEl = shadow.getElementById('pdf-chat-input');
  const sendBtn = shadow.getElementById('pdf-chat-send');
  const toggleBtn = shadow.getElementById('pdf-chat-toggle');

  let sendHandler = null;

  // Collapse/expand
  toggleBtn.addEventListener('click', () => {
    const collapsed = panelEl.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '+' : '−';
  });

  // Draggable
  let dragging = false, sx, sy, sr, sb;
  shadow.getElementById('pdf-chat-header').addEventListener('mousedown', (e) => {
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    const r = panelEl.getBoundingClientRect();
    sr = window.innerWidth - r.right;
    sb = window.innerHeight - r.bottom;
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panelEl.style.right = Math.max(0, sr - (e.clientX - sx)) + 'px';
    panelEl.style.bottom = Math.max(0, sb - (e.clientY - sy)) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  async function doSend() {
    if (!sendHandler) return;
    const question = inputEl.value.trim();
    if (!question) return;
    inputEl.value = '';
    appendMessage('user', question);
    sendBtn.disabled = true;
    inputEl.disabled = true;
    const loadingEl = appendMessage('assistant', 'Thinking...', 'loading');
    try {
      const result = await sendHandler(question);
      loadingEl.remove();
      appendMessage('assistant', result.answer, null, result.pages);
    } catch (err) {
      loadingEl.remove();
      appendMessage('assistant', '⚠ ' + err.message);
    } finally {
      sendBtn.disabled = false;
      inputEl.disabled = false;
      inputEl.focus();
    }
  }

  sendBtn.addEventListener('click', doSend);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });

  function appendMessage(role, text, cls, pages) {
    const msg = document.createElement('div');
    msg.className = 'message ' + role + (cls ? ' ' + cls : '');
    msg.textContent = text;
    if (pages && pages.length) {
      const badges = document.createElement('div');
      badges.className = 'page-badges';
      pages.forEach((p) => {
        const badge = document.createElement('span');
        badge.className = 'page-badge';
        badge.textContent = 'p.' + p;
        badge.addEventListener('click', () => scrollToPage(p));
        badges.appendChild(badge);
      });
      msg.appendChild(badges);
    }
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return msg;
  }

  return {
    setStatus(msg, cls) {
      statusEl.textContent = msg;
      statusEl.className = cls || '';
    },
    setError(msg, showRetry) {
      statusEl.textContent = '⚠ ' + msg;
      statusEl.className = 'error';
    },
    setReady(sid) {
      statusEl.textContent = '✓ Ready — ask a question';
      statusEl.className = 'ready';
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    },
    onSend(fn) { sendHandler = fn; },
  };
}

function scrollToPage(pageNum) {
  try {
    if (window.PDFViewerApplication) window.PDFViewerApplication.page = pageNum;
  } catch (_) {}
}
