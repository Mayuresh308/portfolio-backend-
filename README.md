# Portfolio chat backend

Backend for the "Ask about Mayuresh" chat widget on the Hugo portfolio (a separate project).
It is a small set of Vercel Functions (TypeScript, Node 20+, Web-standard `Request`/`Response`).
Answers come from Gemini, grounded only in the private `knowledge/` folder, with an optional Groq fallback.

## Endpoints

| Method | Path          | Description |
|--------|---------------|-------------|
| POST   | `/api/chat`   | Body `{ "messages": [{ "role": "user" \| "assistant", "content": "..." }] }`. Streams the answer as `text/plain; charset=utf-8`. |
| OPTIONS| `/api/chat`   | CORS preflight. |
| GET    | `/api/health` | `{ "ok": true, "model": "<gemini model id>" }` |

Rules for `/api/chat`:

- 1–12 messages, the last one from `user`, each at most 600 chars, at most 4,000 chars in total, body at most 10 KB. Otherwise you get a 400 or 413 with `{ "error": "..." }`.
- Browser requests must come from an origin in `ALLOWED_ORIGINS`; anything else gets a 403. Requests with no `Origin` header (curl, scripts) are allowed only in local dev.
- Per-IP rate limit: 10 requests/minute and 60/day. Going over returns a 429 with `Retry-After`.
- If Gemini is rate-limited and the fallback is also rate-limited (or not configured), you get a 429 with the message "Lots of questions right now — please try again in a minute or email …".
- Other provider failures return a 503 with a generic message. Stack traces and provider error bodies are never returned.
- Output is capped at about 400 tokens.

> **Frontend note:** when the widget sends back earlier assistant replies as history, trim each one to
> 600 characters (e.g. `content.slice(0, 600)`) and send at most the last 12 messages. A full answer can
> exceed 600 characters, and an untrimmed reply would get a 400.

## Project layout

```
api/chat.ts            POST/OPTIONS handler (CORS → rate limit → validation → stream)
api/health.ts          GET health check
src/prompt.ts          system prompt (persona, grounding rules, scope, confidentiality)
src/knowledge.ts       loads knowledge/*.md once per cold start
src/answer.ts          Gemini first, Groq fallback on 429/5xx/network errors
src/providers/         gemini.ts (@google/genai), groq.ts (plain fetch, OpenAI-compatible)
src/ratelimit.ts       Upstash limiter, or an in-memory per-instance fallback
src/cors.ts, validate.ts, http.ts, config.ts
knowledge/             PRIVATE library (bundled into the function, never served)
scripts/eval.ts        `pnpm eval` manual eval
scripts/list-models.ts `pnpm models` lists Gemini models for your key
test/chat.html         bare-bones manual test page
public/                the only statically served folder (just robots.txt)
```

`vercel.json` sets `outputDirectory: "public"`, so `knowledge/`, `src/` and `test/` are **not** served as
static files. It also uses `includeFiles` to bundle `knowledge/**` into the chat function only.

## Setup

Requires Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env.local   # then fill in real values (never commit this file)
pnpm typecheck
```

### Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `GEMINI_API_KEY` | yes | From https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.8-flash`. Run `pnpm models` to see what your key can use. |
| `GROQ_API_KEY` | no | Enables the fallback (only on Gemini 429 / 5xx / network errors). |
| `GROQ_MODEL` | with Groq | e.g. `openai/gpt-oss-120b` or `llama-3.3-70b-versatile`. |
| `ALLOWED_ORIGINS` | yes | Comma-separated, exact match, e.g. `https://your-site.vercel.app,http://localhost:1313` |
| `PORTFOLIO_URL` | recommended | Mentioned by the assistant. Not hardcoded. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | recommended in prod | Shared rate limit. Without them, an in-memory limiter is used; it is per-instance only, and a warning is logged. |

## Local development (`vercel dev`)

```bash
pnpm add -g vercel     # or: npm i -g vercel  (skip if `vercel --version` works)
vercel login
vercel link            # first time only: create/link a Vercel project
pnpm dev               # = vercel dev, serves http://localhost:3000
```

`vercel dev` reads `.env.local`. Restart it after changing env vars or knowledge files.

Quick checks:

```bash
curl http://localhost:3000/api/health
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "Origin: http://localhost:1313" \
  -d '{"messages":[{"role":"user","content":"Does he know RAG?"}]}'
```

### Manual test page

`test/chat.html` posts to `http://localhost:3000/api/chat` and renders the streamed reply. Either:

- serve it on an allowed origin: `pnpm dlx serve test -l 1313` (stop Hugo first if it uses 1313), then open
  http://localhost:1313/chat.html, **or**
- open the file directly. A page opened from disk sends `Origin: null`, so add `null` to `ALLOWED_ORIGINS`
  in `.env.local` only. Never add it in production.

### Eval

With `vercel dev` running:

```bash
pnpm eval
```

This sends 15 questions (in-scope, unknown, off-scope/injection) and prints question → answer → latency,
plus the expected behavior, so you can mark pass/fail yourself. It waits out the 10/min rate limit
automatically. With Upstash configured locally, each run uses 15 of the 60/day quota for your IP.
Set `EVAL_BASE_URL` to run it against a deployment. The deployment must allow `EVAL_ORIGIN`
(default `http://localhost:1313`).

## Adding knowledge

Any `.md` file in `knowledge/` is loaded automatically (except `README.md`). Fill in the
`<!-- add more bullets -->` spots and the empty sections in `faq.md`. HTML comments are stripped before
loading, so empty FAQ sections stay "unknown" until you write real text. See [knowledge/README.md](knowledge/README.md).
Redeploy after changes.

## Deploy

1. Create a **private** GitHub repo and push this folder:
   ```bash
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```
2. In Vercel: **Add New → Project → Import** that repo. Framework preset: **Other**. Leave the build
   settings as they are (`vercel.json` handles them).
3. **Settings → Environment Variables** (Production, plus Preview if you want): `GEMINI_API_KEY`,
   `GEMINI_MODEL`, `ALLOWED_ORIGINS` (your portfolio domain; add `http://localhost:1313` only if you want
   local Hugo to reach prod), `PORTFOLIO_URL`, and optionally `GROQ_API_KEY`/`GROQ_MODEL` and
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` (the Upstash integration in the Vercel Marketplace
   can add these for you).
4. Deploy, then check `https://<backend>.vercel.app/api/health`.
5. Note the deployed URL. The frontend widget calls `https://<backend>.vercel.app/api/chat`.
6. Make sure the portfolio's exact origin (scheme + host, no trailing slash) is in `ALLOWED_ORIGINS`.
   Redeploy after changing env vars.
