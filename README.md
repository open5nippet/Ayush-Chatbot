# Ask me about Ayush — Portfolio Chatbot

A conversational assistant that lets recruiters and hiring managers ask questions about **[[YOUR_NAME]]**'s skills, projects, and experience. Built with plain HTML/CSS/JS on the front end, a Vercel serverless proxy, and an n8n AI agent on the back end.

---

## How the pieces connect

```
Browser (index.html + app.js)
  │  POST { sessionId, message }
  ▼
Vercel Serverless Function (/api/chat.js)
  │  Validates input, rate-limits, adds x-api-key header
  │  POST { sessionId, message }  →  x-api-key: N8N_SHARED_SECRET
  ▼
n8n Production Webhook (via tunnel)
  │
  ▼
AI Agent (n8n workflow) → reply
  │
  ▼
Back up the chain → { reply: "..." }
  │
  ▼
Browser displays reply in the chat
```

**Why the proxy?**
- Keeps `N8N_WEBHOOK_URL` and `N8N_SHARED_SECRET` on the server — they never appear in browser code or network responses.
- Handles CORS so the browser only talks to the same origin (`/api/chat`).
- Adds input validation, rate limiting, and timeout protection.

---

## Project structure

```
/
├── index.html          ← Single page; references CSS and JS
├── css/
│   └── style.css       ← All styles, CSS custom properties for theming
├── js/
│   └── app.js          ← All front-end logic (vanilla JS, no libraries)
├── api/
│   └── chat.js         ← Vercel serverless function (Node.js, ES module)
├── assets/
│   ├── favicon.svg     ← Inline SVG favicon
│   └── og-image.png    ← Social share image (replace with a real PNG)
├── vercel.json         ← maxDuration for the function + security headers
├── .env.example        ← Template for environment variables
├── .gitignore
└── README.md           ← This file
```

---

## Running locally on Windows 11

### Prerequisites

1. **Node.js 18 or later** — download from [nodejs.org](https://nodejs.org).
   After installing, open PowerShell and verify:
   ```powershell
   node -v
   ```
2. **Vercel CLI** — install it once, globally:
   ```powershell
   npm install -g vercel
   ```

### Step 1 — Create your local environment file

Copy the example file and fill in real values:
```powershell
Copy-Item .env.example .env
notepad .env
```

Add your values:
```
N8N_WEBHOOK_URL=https://your-tunnel-url.ngrok-free.app/webhook/your-path
N8N_SHARED_SECRET=the-secret-you-set-in-n8n
```

> **Note:** `.env` is in `.gitignore`. It will never be committed to Git.

### Step 2 — Start the local dev server

```powershell
vercel dev
```

`vercel dev` does two things at once:
- Serves your static files (`index.html`, CSS, JS) at `http://localhost:3000`
- Runs the serverless function at `http://localhost:3000/api/chat`
- Reads your `.env` file automatically

Open your browser to **http://localhost:3000**.

### Step 3 — Test without n8n (mock mode)

If your n8n tunnel isn't running yet, open `js/app.js` and change line 17:
```js
const MOCK_MODE = true;  // ← change false to true
```
Reload the page — the chat will work with fake replies. Change it back to `false` when you're ready to use the real backend.

---

## vercel.json — why it exists

| Setting | Reason |
|---|---|
| `maxDuration: 30` | The default Hobby plan timeout is 10 s, which is too short for an AI response. This raises it to 30 s. **Verify the current Hobby plan limit at [vercel.com/docs/functions/runtimes#max-duration](https://vercel.com/docs/functions/runtimes#max-duration) — limits can change.** |
| Security headers | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, and `Content-Security-Policy` applied to all routes. |

### Content Security Policy (CSP) — what to adjust if something breaks

The CSP in `vercel.json` currently allows:
- `script-src 'self'` — only scripts from your own domain
- `style-src 'self' https://fonts.googleapis.com` — your CSS + Google Fonts CSS
- `font-src https://fonts.gstatic.com` — the actual font files
- `connect-src 'self'` — `fetch()` calls only to `/api/chat`

**If you add an analytics script** (e.g. Plausible, Fathom), add its domain to `script-src`.
**If you add external images**, add their host to `img-src`.
**If the Google Fonts stylesheet ever breaks**, check that `fonts.googleapis.com` is still in `style-src`.

---

## Placeholders to replace

Search the codebase for these strings and replace them with your real information:

| Placeholder | Where it appears | What to put |
|---|---|---|
| `[[YOUR_NAME]]` | `index.html`, `assets/og-image.png` | Your full name (e.g. `Ayush Sharma`) |
| `[[ROLE_TAGLINE]]` | `index.html`, `assets/og-image.png` | A one-line role (e.g. `Full-Stack Developer & CS Student`) |
| `[[GITHUB_URL]]` | `index.html` | Your GitHub profile URL |
| `[[LINKEDIN_URL]]` | `index.html` | Your LinkedIn profile URL |
| `[[EMAIL]]` | `index.html` (×2) | Your email address |

Also review and update the suggested questions in `index.html` (the four `<button class="suggestion-btn">` elements) and the welcome paragraph to reflect your actual background.

---

## Test checklist

| Test | How to run it |
|---|---|
| **Mock mode** | Set `MOCK_MODE = true` in `app.js`, reload, send any message. You should see a fake reply after ~1.2 s. |
| **Offline backend** | Set `MOCK_MODE = false`, stop n8n / disable the tunnel, send a message. You should see the "offline" error with a "Try again" button. |
| **Long message** | Type 490+ characters — the character counter should appear. Try to send 501+ characters — the textarea's `maxlength` prevents it. |
| **Rapid double send** | Click Send twice quickly (or press Enter twice). The button should be disabled after the first click and no duplicate messages should appear. |
| **Mobile layout** | Open Chrome DevTools → Toggle device toolbar. Check that the composer stays visible when the keyboard opens (use an iPhone SE or Pixel preset). |
| **Dark mode** | In Chrome DevTools → Rendering → Emulate CSS prefers-color-scheme: dark. The whole UI should switch to the dark palette. |
| **New conversation** | Click the refresh icon button — the chat should clear and the welcome panel should return. |
| **Offline browser** | In Chrome DevTools → Network → select "Offline". The yellow banner should appear immediately without sending anything. |
