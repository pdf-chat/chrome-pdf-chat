const statusEl = document.getElementById('pdf-chat-status');
const messagesEl = document.getElementById('pdf-chat-messages');
const inputEl = document.getElementById('pdf-chat-input');
const sendBtn = document.getElementById('pdf-chat-send');
const toggleBtn = document.getElementById('pdf-chat-toggle');
const panelEl = document.getElementById('pdf-chat-panel');
let sessionId = null;
let pdfPages = [];

// Receive state from content script
window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const d = e.data;
  if (d.type === 'SET_STATUS') { statusEl.textContent = d.msg; statusEl.className = d.cls || ''; }
  if (d.type === 'SET_ERROR')  { statusEl.textContent = '⚠ ' + d.msg; statusEl.className = 'error'; }
  if (d.type === 'SET_READY')  { setReady(d.sessionId, d.pages); }
});

function setReady(sid, pages) {
  sessionId = sid;
  pdfPages = pages || [];
  statusEl.textContent = '✓ Ready — ask a question';
  statusEl.className = 'ready';
  inputEl.disabled = false;
  sendBtn.disabled = false;
  inputEl.focus();
}

function getQuoteContext(pageNum, quote) {
  const page = pdfPages.find(p => p.page === pageNum);
  if (!page || !quote) return null;
  const text = page.text;
  let idx = text.indexOf(quote);
  if (idx === -1) {
    // Fallback: match on first 4 words in case of minor LLM rewording
    const probe = quote.trim().split(/\s+/).slice(0, 4).join(' ');
    idx = text.indexOf(probe);
  }
  if (idx === -1) return null;
  const W = 120;
  const start = Math.max(0, idx - W);
  const end = Math.min(text.length, idx + quote.length + W);
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, idx),
    match: text.slice(idx, idx + quote.length),
    after: text.slice(idx + quote.length, end) + (end < text.length ? '…' : ''),
  };
}

// Collapse / expand — tell content script to resize the iframe
toggleBtn.addEventListener('click', () => {
  const collapsed = panelEl.classList.toggle('collapsed');
  toggleBtn.textContent = collapsed ? '+' : '−';
  window.parent.postMessage({ type: 'TOGGLE_COLLAPSE', collapsed }, '*');
});

// Send message
async function doSend() {
  if (!sessionId) return;
  const question = inputEl.value.trim();
  if (!question) return;
  inputEl.value = '';
  appendMessage('user', question);
  sendBtn.disabled = true;
  inputEl.disabled = true;
  const loadingEl = appendMessage('assistant', 'Thinking...', 'loading');
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'API_REQUEST', endpoint: '/session/query', method: 'POST', body: {
          session_id: sessionId,
          question,
        }},
        (response) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (response && response.__error) return reject(new Error(response.__error));
          resolve(response);
        }
      );
    });
    loadingEl.remove();
    appendMessage('assistant', result.answer, null, result.citations);
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

function appendMessage(role, text, cls, citations) {
  const msg = document.createElement('div');
  msg.className = 'message ' + role + (cls ? ' ' + cls : '');
  const textEl = document.createElement('div');
  textEl.textContent = text;
  msg.appendChild(textEl);
  if (citations && citations.length) {
    const badges = document.createElement('div');
    badges.className = 'page-badges';
    citations.forEach((c) => {
      const badge = document.createElement('span');
      badge.className = 'page-badge';
      badge.textContent = 'p.' + c.page;
      const quoteEl = document.createElement('div');
      quoteEl.className = 'citation-quote';
      const ctx = getQuoteContext(c.page, c.quote);
      if (ctx) {
        const before = document.createElement('span');
        before.className = 'citation-context';
        before.textContent = ctx.before;
        const mark = document.createElement('mark');
        mark.className = 'citation-highlight';
        mark.textContent = ctx.match;
        const after = document.createElement('span');
        after.className = 'citation-context';
        after.textContent = ctx.after;
        quoteEl.append(before, mark, after);
      } else {
        quoteEl.textContent = c.quote || '(no quote provided)';
      }
      badge.addEventListener('click', () => {
        const showing = badge.classList.toggle('active');
        quoteEl.classList.toggle('open', showing);
        window.parent.postMessage({ type: 'SCROLL_TO_PAGE', page: c.page }, '*');
      });
      badges.appendChild(badge);
      msg.appendChild(quoteEl);
    });
    msg.insertBefore(badges, msg.children[1] || null);
  }
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msg;
}
