# Portfolio chat backend

Backend for the "Ask about Mayuresh" chat widget on the Hugo portfolio (a separate project).
It is a small set of Vercel Functions (TypeScript, Node 20+, Web-standard `Request`/`Response`).
Answers come from Gemini, grounded only in the private `knowledge/` folder, with an optional Groq fallback.
MongoDB Atlas (optional) provides shared rate limiting, question logs and answer feedback.

## Endpoints

| Method | Path            | Description |
|--------|-----------------|-------------|
| POST   | `/api/chat`     | Body `{ "messages": [{ "role": "user" \| "assistant", "content": "..." }], "conversationId"?: string, "messageIndex"?: number }`. Streams the answer as `text/plain; charset=utf-8`. |
| POST   | `/api/feedback` | Body `{ "conversationId": string, "messageIndex": number, "rating": "up" \| "down" }`. Returns 204. |
| OPTIONS| both            | CORS preflight. |
| GET    | `/api/health`   | `{ "ok": true, "model": "<gemini model id>" }` |

Rules for `/api/chat`:

- 1–12 messages, the last one from `user`, each at most 600 chars, at most 4,000 chars in total, body at most 10 KB. Otherwise you get a 400 or 413 with `{ "error": "..." }`.
- Optional `conversationId`: 8–64 characters of letters, digits, `-` or `_`, generated randomly by the widget per conversation. Optional `messageIndex` (0–199): the position the reply will have in the widget's conversation. It defaults to the number of messages sent. Feedback refers to a reply by this pair.
- Browser requests must come from an origin in `ALLOWED_ORIGINS`; anything else gets a 403. Requests with no `Origin` header (curl, scripts) are allowed only in local dev.
- Per-IP rate limit: 10 requests/minute and 60/day, shared by `/api/chat` and `/api/feedback`. Going over returns a 429 with `Retry-After`.
- If Gemini is rate-limited and the fallback is also rate-limited (or not configured), you get a 429 with the message "Lots of questions right now — please try again in a minute or email …".
- Other provider failures return a 503 with a generic message. Stack traces and provider error bodies are never returned.
- Output is capped at about 400 tokens.
- When the answer isn't in the notes, the reply starts with exactly "That isn't in Mayuresh's notes". This is how logs flag unanswered questions.

`/api/feedback` uses the same CORS and rate limit. It is strictly validated (exactly those three fields, body at most 1 KB), and is stored without blocking the response.

> **Frontend note:** when the widget sends back earlier assistant replies as history, trim each one to
> 600 characters (e.g. `content.slice(0, 600)`) and send at most the last 12 messages. A full answer can
> exceed 600 characters, and an untrimmed reply would get a 400.

## Project layout

```
api/chat.ts             POST/OPTIONS handler (CORS → rate limit → validation → stream → log)
api/feedback.ts         POST/OPTIONS thumbs up/down on an answer
api/health.ts           GET health check
src/prompt.ts           system prompt (persona, grounding rules, scope, confidentiality)
src/knowledge.ts        loads knowledge/*.md once per cold start
src/answer.ts           Gemini first, Groq fallback on 429/5xx/network errors
src/providers/          gemini.ts (@google/genai), groq.ts (plain fetch, OpenAI-compatible)
src/db.ts               cached MongoClient, collections, indexes (created once per cold start)
src/ratelimit.ts        MongoDB fixed-window limiter, in-memory fallback
src/chatlog.ts          question logging + feedback storage (best-effort)
src/cors.ts, validate.ts, http.ts, config.ts, env.ts
knowledge/              PRIVATE library (bundled into the chat function, never served)
scripts/eval.ts         `pnpm eval` manual eval
scripts/questions.ts    `pnpm questions` review logged questions and feedback
scripts/list-models.ts  `pnpm models` lists Gemini models for your key
test/chat.html          bare-bones manual test page
public/                 the only statically served folder (just robots.txt)
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
| `MONGODB_URI` | recommended in prod | Atlas connection string. Without it, logging and feedback are skipped, and the in-memory limiter is used (per-instance only, with a warning). |
| `MONGODB_DB` | no | Database name. Defaults to `portfolio_chat`. |
| `MONGODB_DNS_SERVERS` | no, local dev only | e.g. `8.8.8.8,1.1.1.1`. Use it if `mongodb+srv://` fails locally with `querySrv ECONNREFUSED` (your resolver refuses SRV lookups). Ignored on Vercel. |
| `RATE_LIMIT_SALT` | with MongoDB | Secret salt for hashing IPs in rate-limit keys. Without it, the in-memory limiter is used. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |

## MongoDB Atlas setup

1. Create a free **M0** cluster at https://cloud.mongodb.com (AWS, **us-east-1**, the same region as Vercel's
   default functions region, which keeps latency low).
2. **Database Access → Add New Database User**: password auth, with a **least-privilege** role.
   Under *Specific Privileges*, choose `readWrite` on database `portfolio_chat` only, not "Atlas admin" or
   "readWriteAnyDatabase".
3. **Network Access → Add IP Address → `0.0.0.0/0`**. Vercel functions have no fixed outbound IPs, so this
   is needed. Access is still protected by the user's credentials and TLS. Use a long random password.
4. **Connect → Drivers** and copy the `mongodb+srv://…` string into `MONGODB_URI` (in `.env.local`
   and in the Vercel project's env vars). Set `MONGODB_DB=portfolio_chat` and a random `RATE_LIMIT_SALT`.
5. There's nothing else to create. Collections and indexes (including the TTL indexes) are created
   automatically on first use:

| Collection | Contents | Cleanup |
|------------|----------|---------|
| `rate_limits` | `{ _id: "<ipHash>:m:<minute>" \| "<ipHash>:d:<day>", count, expiresAt }` | TTL on `expiresAt` (shortly after the window ends) |
| `chat_logs` | `{ ts, conversationId?, messageIndex, question, answer (first 500 chars), answered, model }` | TTL: 90 days after `ts` |
| `chat_feedback` | `{ ts, conversationId, messageIndex, rating }` | TTL: 90 days after `ts` |

If MongoDB is down or slow, chat keeps working. Rate limiting falls back to the in-memory limiter for
30 seconds at a time, and logging/feedback writes are dropped (a warning is logged, without content).

### Privacy

- **No IPs are stored.** Rate-limit keys use `SHA-256(RATE_LIMIT_SALT + IP)`, and those counters expire
  within minutes (per-minute) or a day (per-day).
- Logs hold only the question, the start of the answer, whether it was answered, the model, and the
  widget's random `conversationId`. There's no IP, IP hash, user agent, or other identifier.
- Rejected or invalid requests are never logged.
- Logs and feedback are deleted automatically after **90 days**.
- Consider mentioning in the widget or the site's privacy note that questions are stored for 90 days to
  improve answers.

### Weekly review routine (about 10 minutes)

```bash
pnpm questions --stats        # answered %, top unanswered questions
pnpm questions --unanswered   # what the notes couldn't answer
pnpm questions --feedback     # thumbs-down answers with their question
pnpm questions --csv logs.csv # optional: export for a spreadsheet
# add --include-eval to any of these to include `pnpm eval` runs (hidden by default)
```

1. For each frequent **unanswered** question that you're happy to answer publicly, add the fact to
   `knowledge/` (often `faq.md`).
2. For each **thumbs-down**, check the answer against `knowledge/`. Fix wording or missing context in the
   notes, or tighten `src/prompt.ts` if the model misbehaved.
3. Run `pnpm eval`, then deploy.

## Local development (`vercel dev`)

```bash
pnpm install           # the Vercel CLI is a devDependency
pnpm exec vercel login
pnpm exec vercel link  # first time only: create/link a Vercel project
pnpm serve             # = vercel dev, serves http://localhost:3000
```

**How env vars reach the function locally:** `vercel dev` (CLI 62.x) only reads `.env`. Without one, it
injects the linked project's cloud *Development* env vars, and it never reads `.env.local`. So the app
loads `.env.local` itself in local dev (`src/env.ts`), and those values override whatever `vercel dev`
injected. `pnpm eval`, `pnpm questions` and `pnpm models` use the same loader. On deployments
(`VERCEL_ENV` is production/preview) the loader does nothing, and only the Vercel dashboard env vars are
used.

In local dev, each function cold start logs a `dev_startup` line with the env file used, the parsed
`ALLOWED_ORIGINS`, the model id, and whether MongoDB and the salt are set (never keys). Restart
`vercel dev` after changing knowledge files.

Note: `vercel dev` starts a fresh function process per request, so the in-memory limiter does not limit
anything locally. With MongoDB configured, rate limits apply locally too. Local requests (including
`pnpm eval`) count against your IP and are logged in the same database.

Quick checks:

```bash
curl http://localhost:3000/api/health
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "Origin: http://localhost:1313" \
  -d '{"messages":[{"role":"user","content":"Does he know RAG?"}],"conversationId":"test-conversation-1"}'
curl -i -X POST http://localhost:3000/api/feedback \
  -H "Content-Type: application/json" -H "Origin: http://localhost:1313" \
  -d '{"conversationId":"test-conversation-1","messageIndex":1,"rating":"up"}'
```

### Manual test page

`test/chat.html` posts to `http://localhost:3000/api/chat` and renders the streamed reply. Either:

- serve it on an allowed origin: `pnpm dlx serve test -l 1313` (stop Hugo first if it uses 1313), then open
  http://localhost:1313/chat.html, **or**
- open the file directly. A page opened from disk sends `Origin: null`, so add `null` to `ALLOWED_ORIGINS`
  in `.env.local` only. Never add it in production.

### Eval

With `pnpm serve` running:

```bash
pnpm eval
```

This sends 22 questions (in-scope, unknown, off-scope/injection) and prints question → answer → latency,
whether the reply starts with the "not in the notes" phrase, and the expected behavior, so you can mark
pass/fail yourself. It waits out the 10/min rate limit automatically. Each run uses 22 of the 60/day
quota for your IP, and its questions are logged with `conversationId`s starting with `eval`, which
`pnpm questions` hides unless you pass `--include-eval`.

To run it against a deployment, set `EVAL_URL` (the full chat URL) and `EVAL_ORIGIN` (an origin the
deployment allows; default `http://localhost:1313`):

```bash
EVAL_URL=https://<backend>.vercel.app/api/chat EVAL_ORIGIN=https://<portfolio>.vercel.app pnpm eval
```

## Adding knowledge

Any `.md` file in `knowledge/` is loaded automatically (except `README.md`). HTML comments are stripped
before loading, so use them for notes to yourself. See [knowledge/README.md](knowledge/README.md).
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
   local Hugo to reach prod), `PORTFOLIO_URL`, `MONGODB_URI`, `MONGODB_DB`, `RATE_LIMIT_SALT`, and
   optionally `GROQ_API_KEY`/`GROQ_MODEL`.
4. Deploy, then check `https://<backend>.vercel.app/api/health`.
5. Note the deployed URL. The frontend widget calls `https://<backend>.vercel.app/api/chat` (and
   `/api/feedback`).
6. Make sure the portfolio's exact origin (scheme + host, no trailing slash) is in `ALLOWED_ORIGINS`.
   Redeploy after changing env vars.
