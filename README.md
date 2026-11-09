# Portfolio Chatbot

Live demo: https://ayushchatbot.vercel.app

The backend runs on my own machine through a tunnel, so the chat may show an offline message when my computer is off.

This project is a small portfolio chatbot with a plain HTML, CSS, and JavaScript interface. Visitors can send a question through the browser and receive a response from an AI agent managed in n8n.

Built by Ayush Kumar as a portfolio project to learn n8n, Docker, and serverless deployment.

<!-- TODO: save a screenshot as assets/screenshot.png before publishing -->
![Screenshot of the chatbot](assets/screenshot.png)

## Architecture

```
Browser -> Vercel -> serverless proxy -> ngrok tunnel -> n8n webhook (Docker) -> AI agent -> Gemini
```

The browser sends each message to the same-origin `/api/chat` endpoint. The Vercel serverless function validates the request and forwards it to the n8n webhook. The webhook invokes the AI agent and returns its reply through the proxy to the browser. The webhook URL and shared secret remain server-side environment variables.

## Tech stack

- HTML, CSS, and vanilla JavaScript
- Vercel serverless functions
- n8n
- Docker
- ngrok (tunnel)
- Gemini

## Run locally

1. Install a current LTS version of Node.js and the Vercel CLI.

   ```powershell
   npm install -g vercel
   ```

2. Copy `.env.example` to `.env` and add the required values.

   ```powershell
   Copy-Item .env.example .env
   ```

   ```sh
   cp .env.example .env
   ```

3. Start the development server.

   ```powershell
   vercel dev
   ```

4. Open the local address shown by Vercel, usually `http://localhost:3000`. If `vercel dev` misbehaves, deploy to Vercel and test there.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `N8N_WEBHOOK_URL` | URL of the n8n webhook that receives chat messages. |
| `N8N_SHARED_SECRET` | Shared secret used by the serverless proxy to authenticate with n8n. |

Keep these values only in `.env` or your Vercel project settings. Do not commit them to the repository.

## Known limitations

- The backend runs on my own laptop through a tunnel, so the chat may be offline when my laptop is off.
- In-memory chat history resets when n8n restarts.
