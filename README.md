# Portfolio Chatbot

This project is a small portfolio chatbot with a plain HTML, CSS, and JavaScript interface. Visitors can send a question through the browser and receive a response from an AI agent managed in n8n.

TODO: Add a screenshot or demo GIF.

## Architecture

```
Browser -> Vercel -> serverless proxy -> n8n webhook -> AI agent -> Gemini
```

The browser sends each message to the same-origin `/api/chat` endpoint. The Vercel serverless function validates the request and forwards it to the n8n webhook. The webhook invokes the AI agent and returns its reply through the proxy to the browser. The webhook URL and shared secret remain server-side environment variables.

## Tech stack

- HTML, CSS, and vanilla JavaScript
- Vercel serverless functions
- n8n
- Gemini

## Run locally

1. Install Node.js 18 or later and the Vercel CLI.

   ```powershell
   npm install -g vercel
   ```

2. Create a local environment file from the example.

   ```powershell
   Copy-Item .env.example .env
   ```

3. Add the required values to your local `.env` file.

4. Start the development server.

   ```powershell
   vercel dev
   ```

5. Open the local address shown by Vercel, usually `http://localhost:3000`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `N8N_WEBHOOK_URL` | URL of the n8n webhook that receives chat messages. |
| `N8N_SHARED_SECRET` | Shared secret used by the serverless proxy to authenticate with n8n. |

Keep these values only in `.env` or your Vercel project settings. Do not commit them to the repository.

## Known limitations

- The backend runs on my own laptop through a tunnel, so the chat may be offline when my laptop is off.
- In-memory chat history resets when n8n restarts.
