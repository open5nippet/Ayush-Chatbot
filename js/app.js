/* ============================================================
   app.js — Portfolio Chatbot Front-End Logic
   Plain vanilla JavaScript — no libraries or build tools.

   HOW TO USE MOCK MODE:
   Set MOCK_MODE = true (line below) to test the UI without
   connecting to n8n. The chat will work normally but replies
   come from a fake function instead of the real server.
   Set it back to false when you're ready to use the real API.
   ============================================================ */

// ─────────────────────────────────────────────────────────────
// SECTION 1 — Configuration
// ─────────────────────────────────────────────────────────────

/**
 * MOCK_MODE: Set to true to test the UI with fake replies.
 * When true, NO network requests are made to /api/chat.
 * Flip to false when your n8n backend is running.
 */
const MOCK_MODE = false;

// Max message length — must match the server-side limit in /api/chat.js
const MAX_CHARS = 500;
// Show character counter once remaining chars drops to this threshold
const CHAR_WARN_THRESHOLD = 80;
// Minimum delay (ms) for mock replies — makes the typing indicator visible
const MOCK_REPLY_DELAY_MS = 1200;

// ─────────────────────────────────────────────────────────────
// SECTION 2 — DOM References
// ─────────────────────────────────────────────────────────────
const messageList   = document.getElementById('message-list');
const welcomePanel  = document.getElementById('welcome-panel');
const composerForm  = document.getElementById('composer-form');
const messageInput  = document.getElementById('message-input');
const btnSend       = document.getElementById('btn-send');
const btnNewChat    = document.getElementById('btn-new-chat');
const charCount     = document.getElementById('char-count');
const offlineBanner = document.getElementById('offline-banner');

// ─────────────────────────────────────────────────────────────
// SECTION 3 — Session Management
// ─────────────────────────────────────────────────────────────

/**
 * We store a UUID in localStorage so n8n can keep conversations
 * separate for each visitor. If localStorage is blocked (some
 * private-browsing modes), we fall back to a memory variable.
 */
let _sessionId = null; // in-memory fallback

function generateUUID() {
  // crypto.randomUUID() is available in all modern browsers
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Very basic fallback for extremely old browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getSessionId() {
  if (_sessionId) return _sessionId;
  try {
    let id = localStorage.getItem('chat_session_id');
    if (!id) {
      id = generateUUID();
      localStorage.setItem('chat_session_id', id);
    }
    _sessionId = id;
    return id;
  } catch {
    // localStorage not available
    _sessionId = generateUUID();
    return _sessionId;
  }
}

function resetSession() {
  _sessionId = generateUUID();
  try {
    localStorage.setItem('chat_session_id', _sessionId);
  } catch {
    // ignore storage errors
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 4 — State
// ─────────────────────────────────────────────────────────────

let isLoading        = false;    // true while waiting for a reply
let lastUserMessage  = null;     // used by the "Try again" button
let typingRow        = null;     // the DOM node showing the typing indicator
let isFirstMessage   = true;     // controls the welcome panel visibility

// ─────────────────────────────────────────────────────────────
// SECTION 5 — Safe Text Formatter
// ─────────────────────────────────────────────────────────────

/**
 * formatMessage(text) — takes a plain text string and returns
 * a DocumentFragment with safe HTML. Never uses innerHTML with
 * untrusted content. Supports:
 *   - **bold** → <strong>
 *   - Lines starting with "- " → <ul><li>
 *   - Bare URLs → <a rel="noopener noreferrer">
 *   - \n → line breaks / paragraph breaks
 *
 * This is a deliberately small, hand-written formatter.
 * It does NOT support complex Markdown — just the basics.
 */
function formatMessage(text) {
  const fragment = document.createDocumentFragment();
  const lines = text.split('\n');

  let inList = false;
  let ul = null;

  function flushList() {
    if (inList && ul) {
      fragment.appendChild(ul);
      inList = false;
      ul = null;
    }
  }

  for (const line of lines) {
    if (line.startsWith('- ') || line.startsWith('• ')) {
      // Bullet list item
      if (!inList) {
        ul = document.createElement('ul');
        inList = true;
      }
      const li = document.createElement('li');
      appendFormattedInline(li, line.slice(2));
      ul.appendChild(li);
    } else {
      flushList();
      if (line.trim() === '') {
        // Blank line = paragraph break
        fragment.appendChild(document.createElement('br'));
      } else {
        const p = document.createElement('p');
        appendFormattedInline(p, line);
        fragment.appendChild(p);
      }
    }
  }

  flushList();
  return fragment;
}

/**
 * appendFormattedInline(parent, text) — renders **bold** and
 * bare URLs inside a single line, appending nodes to parent.
 */
function appendFormattedInline(parent, text) {
  // Regex to find **bold** or URLs in one pass
  const pattern = /(\*\*(.+?)\*\*|https?:\/\/[^\s<>"]+)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Plain text before this match
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    if (match[0].startsWith('**')) {
      // Bold text
      const strong = document.createElement('strong');
      strong.textContent = match[2];
      parent.appendChild(strong);
    } else {
      // Safe link — NEVER expose arbitrary URLs in href without validation
      const href = match[0];
      // Only allow http and https URLs (already ensured by regex above)
      const a = document.createElement('a');
      a.href       = href;
      a.textContent = href;
      a.target     = '_blank';
      a.rel        = 'noopener noreferrer';
      parent.appendChild(a);
    }

    lastIndex = pattern.lastIndex;
  }

  // Remaining plain text after all matches
  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 6 — DOM Helpers (message rendering)
// ─────────────────────────────────────────────────────────────

/**
 * addMessage(role, content, options)
 * role: 'user' | 'assistant' | 'error'
 * content: string (for user/assistant) or null (for typing indicator)
 * options: { isTyping, retryFn, forceScroll }
 *
 * forceScroll: when true, always scroll to this message even if the user
 * has scrolled up. Use for user-sent messages so your own text is always
 * visible immediately.
 */
function addMessage(role, content, options = {}) {
  const row = document.createElement('div');
  row.classList.add('message-row', role);
  row.setAttribute('role', role === 'error' ? 'alert' : 'article');

  // Screen-reader label
  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'You' : role === 'error' ? 'Error' : 'Ayush Kumar';
  row.appendChild(label);

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (options.isTyping) {
    // Animated dots — role="status" ensures screen readers announce this
    // even though the element is inside a polite aria-live region.
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-label', 'Ayush Kumar is typing');
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) {
      indicator.appendChild(document.createElement('span'));
    }
    bubble.appendChild(indicator);
  } else if (role === 'user') {
    // User text: use textContent — safe from XSS
    bubble.textContent = content;
  } else if (role === 'error') {
    // Error message: safe text + retry button
    const msgText = document.createElement('span');
    msgText.textContent = content;
    bubble.appendChild(msgText);

    if (options.retryFn) {
      const actions = document.createElement('div');
      actions.className = 'error-actions';
      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn-retry';
      retryBtn.type = 'button';
      retryBtn.textContent = 'Try again';
      // BUG FIX: remove the error row before retrying so it doesn't stay
      // on screen and so the user bubble isn't duplicated.
      retryBtn.addEventListener('click', () => {
        row.remove();
        options.retryFn();
      });
      actions.appendChild(retryBtn);
      bubble.appendChild(actions);
    }
  } else {
    // Assistant text: safe formatted content (never innerHTML from server)
    bubble.appendChild(formatMessage(content));
  }

  row.appendChild(bubble);

  // BUG FIX: measure nearBottom BEFORE appending the new row.
  // If we measure after, a tall reply already pushes us past the 80px
  // threshold and the scroll never fires.
  const shouldScroll = options.forceScroll || isNearBottom();
  messageList.appendChild(row);
  if (shouldScroll) {
    chatMain.scrollTo({ top: chatMain.scrollHeight, behavior: 'smooth' });
  }

  return row;
}

/**
 * showTypingIndicator() — adds the animated dots row.
 * Stored in typingRow so we can remove it when the reply arrives.
 */
function showTypingIndicator() {
  typingRow = addMessage('assistant', null, { isTyping: true });
}

function removeTypingIndicator() {
  if (typingRow) {
    typingRow.remove();
    typingRow = null;
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 7 — Scroll Helpers
// ─────────────────────────────────────────────────────────────

const chatMain = document.getElementById('chat-main');

/**
 * isNearBottom() — returns true if the user is within 80px of the
 * bottom of the chat. We check this BEFORE appending a new message
 * so that a tall reply doesn't push us beyond the threshold before
 * we decide whether to scroll.
 */
function isNearBottom() {
  const { scrollTop, scrollHeight, clientHeight } = chatMain;
  return scrollHeight - scrollTop - clientHeight <= 80;
}

// ─────────────────────────────────────────────────────────────
// SECTION 8 — Welcome Panel
// ─────────────────────────────────────────────────────────────

function hideWelcomePanel() {
  if (!welcomePanel.classList.contains('hidden')) {
    welcomePanel.classList.add('hidden');
    welcomePanel.setAttribute('aria-hidden', 'true');
    isFirstMessage = false;
  }
}

// Suggested question buttons — clicking fills in the input and sends.
// Guard with navigator.onLine so the behaviour matches the form submit.
document.querySelectorAll('.suggestion-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!navigator.onLine) {
      offlineBanner.hidden = false;
      return;
    }
    const text = btn.textContent.trim();
    messageInput.value = text;
    updateInputState();
    // Auto-send the suggestion
    sendMessage(text);
  });
});

// ─────────────────────────────────────────────────────────────
// SECTION 9 — Input State Management
// ─────────────────────────────────────────────────────────────

function updateInputState() {
  const len = messageInput.value.length;
  const remaining = MAX_CHARS - len;
  const isEmpty = messageInput.value.trim().length === 0;

  // Send button: disabled when empty or loading
  btnSend.disabled = isEmpty || isLoading;

  // Character counter: show when approaching the limit
  if (remaining <= CHAR_WARN_THRESHOLD) {
    charCount.textContent = `${remaining}`;
    charCount.classList.add('visible');
    if (remaining <= 20) {
      charCount.classList.add('warning');
    } else {
      charCount.classList.remove('warning');
    }
  } else {
    charCount.textContent = '';
    charCount.classList.remove('visible', 'warning');
  }

  // Auto-grow the textarea up to max-height (controlled by CSS).
  // We use a CSS custom property set on the element itself instead of
  // directly writing style.height — this avoids needing 'unsafe-inline'
  // in the Content-Security-Policy while still being able to change height
  // dynamically from JS. The CSS reads --input-height via calc().
  messageInput.style.setProperty('--input-height', 'auto');
  // We need a synchronous reflow to get the real scrollHeight after reset.
  // Reading scrollHeight forces the browser to recalculate layout.
  const scrollH = messageInput.scrollHeight;
  messageInput.style.setProperty('--input-height', scrollH + 'px');
}

messageInput.addEventListener('input', updateInputState);

// Initial state
updateInputState();

// ─────────────────────────────────────────────────────────────
// SECTION 10 — Keyboard Handling
// ─────────────────────────────────────────────────────────────

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    // Enter alone: send the message (if not empty / loading)
    e.preventDefault();
    if (!btnSend.disabled) {
      composerForm.requestSubmit();
    }
  }
  // Shift+Enter: browser default is a new line — we do nothing extra.
});

// ─────────────────────────────────────────────────────────────
// SECTION 11 — API Call
// ─────────────────────────────────────────────────────────────

/**
 * callAPI(message) — sends the message to our serverless proxy
 * at /api/chat and returns the reply string.
 * Throws an Error on failure (the calling function handles it).
 *
 * BUG FIX: every thrown error now has a .code property set.
 * Previously, a network failure threw with no .code, so the
 * friendly-message logic fell through to the raw browser error
 * text ("Failed to fetch"). A non-JSON response threw
 * new Error('offline') with no .code, so the visitor saw the
 * single word "offline" in the chat.
 */
async function callAPI(message) {
  // Helper: creates a typed offline error so the caller always gets
  // err.code === 'offline' and can show the right friendly message.
  const offlineError = () => {
    const e = new Error('The assistant appears to be offline or unreachable.');
    e.code = 'offline';
    return e;
  };

  // Step 1: make the fetch. If the network is completely down or
  // Vercel is unreachable, fetch itself throws — catch that here.
  let response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: getSessionId(),
        message: message,
      }),
    });
  } catch {
    // Network failure (offline, DNS error, Vercel unreachable)
    throw offlineError();
  }

  // Step 2: parse JSON. The proxy always returns JSON, but if
  // something goes very wrong upstream, the body might not be valid.
  let data;
  try {
    data = await response.json();
  } catch {
    throw offlineError();
  }

  // Step 3: handle error status codes. The proxy puts friendly text
  // in data.message and an error code in data.error.
  if (!response.ok) {
    const err = new Error(data.message || 'Something went wrong.');
    err.code = data.error || 'unknown';
    throw err;
  }

  return data.reply;
}

/**
 * mockAPI(message) — returns a fake reply for UI testing.
 * Only called when MOCK_MODE = true.
 */
async function mockAPI(message) {
  await new Promise((r) => setTimeout(r, MOCK_REPLY_DELAY_MS));
  return `[MOCK MODE] You asked: "${message}"\n\nThis is a placeholder reply. Set MOCK_MODE = false in app.js and make sure your n8n webhook is running to get real answers.`;
}

// ─────────────────────────────────────────────────────────────
// SECTION 12 — Send Message
// ─────────────────────────────────────────────────────────────

/**
 * sendMessage(text, { isRetry }) — the central function that:
 *   1. Shows the user's message in the chat (skipped on retry)
 *   2. Shows the typing indicator
 *   3. Calls the API (or mock)
 *   4. Removes the indicator and shows the reply (or an error)
 *
 * isRetry: when true (called from "Try again"), we skip adding the
 * user bubble again because it's already in the conversation.
 */
async function sendMessage(text, { isRetry = false } = {}) {
  // Safety check: don't send if already loading
  if (isLoading) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  // Store for the "Try again" button
  lastUserMessage = trimmed;

  // Hide welcome panel after first send
  hideWelcomePanel();

  if (!isRetry) {
    // Show user message in the conversation with forceScroll so the user's
    // own text is always immediately visible (Bug 3 fix).
    addMessage('user', trimmed, { forceScroll: true });

    // Clear and reset the input (updateInputState handles the height reset)
    messageInput.value = '';
    updateInputState();
  }

  // Enter loading state
  setLoading(true);
  showTypingIndicator();

  try {
    const reply = MOCK_MODE ? await mockAPI(trimmed) : await callAPI(trimmed);
    removeTypingIndicator();
    addMessage('assistant', reply);
  } catch (err) {
    removeTypingIndicator();
    // Map error codes to friendly, beginner-safe messages
    const friendlyMessage = err.code === 'timeout'
      ? 'The assistant took too long to respond. Please try again in a moment.'
      : err.code === 'rate_limit'
      ? 'The assistant is receiving too many requests right now. Please wait a minute and try again.'
      : err.code === 'offline' || !navigator.onLine
      ? 'The assistant appears to be offline or unreachable. Please try again later.'
      : err.message || 'Something went wrong. Please try again.';

    addMessage('error', friendlyMessage, {
      // BUG FIX: pass isRetry: true so the user bubble isn't added twice.
      // The retry button's click handler (in addMessage) removes the error
      // row before calling this, so the screen stays clean.
      retryFn: () => sendMessage(lastUserMessage, { isRetry: true }),
    });
  } finally {
    setLoading(false);
    // BUG FIX: restore focus to the input after every reply so the user
    // can keep typing immediately. On mobile this re-opens the keyboard.
    messageInput.focus();
  }
}

function setLoading(state) {
  isLoading = state;
  btnSend.disabled = state || messageInput.value.trim().length === 0;
  messageInput.disabled = state;
  document.body.classList.toggle('is-loading', state);
}

// ─────────────────────────────────────────────────────────────
// SECTION 13 — Form Submit
// ─────────────────────────────────────────────────────────────

composerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!navigator.onLine) {
    offlineBanner.hidden = false;
    return;
  }
  sendMessage(messageInput.value);
});

// ─────────────────────────────────────────────────────────────
// SECTION 14 — New Conversation Button
// ─────────────────────────────────────────────────────────────

btnNewChat.addEventListener('click', () => {
  if (isLoading) return; // don't reset mid-request

  // Clear the conversation visually
  messageList.innerHTML = '';

  // Show the welcome panel again
  welcomePanel.classList.remove('hidden');
  welcomePanel.setAttribute('aria-hidden', 'false');
  isFirstMessage = true;

  // Reset the session so n8n starts a fresh memory context
  resetSession();

  // Clear any error state
  lastUserMessage = null;

  // Focus the input
  messageInput.focus();
});

// ─────────────────────────────────────────────────────────────
// SECTION 15 — Online / Offline Detection
// ─────────────────────────────────────────────────────────────

function handleOnline() {
  offlineBanner.hidden = true;
}

function handleOffline() {
  offlineBanner.hidden = false;
}

window.addEventListener('online',  handleOnline);
window.addEventListener('offline', handleOffline);

// Set the initial state in case the page loaded offline
if (!navigator.onLine) {
  offlineBanner.hidden = false;
}

// ─────────────────────────────────────────────────────────────
// SECTION 16 — Startup
// ─────────────────────────────────────────────────────────────

// Initialize session on load (creates or retrieves the UUID)
getSessionId();

// Log mock mode warning so it's easy to spot in DevTools
if (MOCK_MODE) {
  console.warn(
    '[chat] MOCK_MODE is ON — no real API calls will be made. ' +
    'Set MOCK_MODE = false in app.js to use the live backend.'
  );
}
