const statusEl = document.getElementById('pdf-chat-status');
const messagesEl = document.getElementById('pdf-chat-messages');
const inputEl = document.getElementById('pdf-chat-input');
const sendBtn = document.getElementById('pdf-chat-send');
const toggleBtn = document.getElementById('pdf-chat-toggle');
const panelEl = document.getElementById('pdf-chat-panel');
const headerEl = document.getElementById('pdf-chat-header');

let sessionId = null;

// Receive state from content script
window.addEventListener('message', (e) => {
  const d = e.data;
  if (d.type === 'SET_STATUS') { statusEl.textContent = d.msg; statusEl.className = d.cls || ''; }
  if (d.type === 'SET_ERROR')  { statusEl.textContent = '⚠ ' + d.msg; statusEl.className = 'error'; }
  if (d.type === 'SET_READY')  { setReady(d.sessionId); }
});

function setReady(sid) {
  sessionId = sid;
  statusEl.textContent = '✓ Ready — ask a question';
  statusEl.className = 'ready';
  inputEl.disabled = false;
  sendBtn.disabled = false;
  inputEl.focus();
}

// Collapse / expand — tell content script to resize the iframe
toggleBtn.addEventListener('click', () => {
  const collapsed = panelEl.classList.toggle('collapsed');
  toggleBtn.textContent = collapsed ? '+' : '−';
  window.parent.postMessage({ type: 'TOGGLE_COLLAPSE', collapsed }, '*');
});

// Drag — send mousedown position to content script, which tracks the mouse
headerEl.addEventListener('mousedown', (e) => {
  if (e.target === toggleBtn) return;
  window.parent.postMessage({ type: 'DRAG_START', offsetX: e.clientX, offsetY: e.clientY }, '*');
  e.preventDefault();
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
    const { model } = await chrome.storage.local.get('model');
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'API_REQUEST', endpoint: '/session/query', method: 'POST', body: {
          session_id: sessionId,
          question,
          model: model || 'gpt-4o',
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
      quoteEl.textContent = c.quote || '(no quote provided)';
      badge.addEventListener('click', () => {
        const showing = badge.classList.toggle('active');
        quoteEl.classList.toggle('open', showing);
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
