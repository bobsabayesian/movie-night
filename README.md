# Scene Sync

Real-time party game: prompt Gemini for a movie scene in a given style, cast friends, act it out on your phones.

- `web/` Vite + React SPA (Cloudflare Pages)
- `worker/` Cloudflare Worker + `LobbyDO` Durable Object (WebSockets), Gemini, R2 ledger
- `shared/` message and state types

## Local dev
```
npm install
echo 'GEMINI_API_KEY=...' > worker/.dev.vars
# set "DEV_ADMIN": "1" in worker/wrangler.jsonc vars (local only)
npm run dev:worker   # :8787 (API; also serves web/dist if built)
npm run dev:web      # Vite with hot reload, proxies /api to :8787
```
Open `/admin` to create a lobby, `/lobby/<id>` on other tabs/phones to join.

## Config and log
- `shared/config.json`: genres, styles, player colors, and the min/max/default number of parts. The host can switch genres and styles off per session in the Admin tab; colors are fixed.
- Every round is logged to R2 (`project-files`) as `movie-night/rounds/<timestamp>_<session>_<round>.json` with who chose it, genre, style, parts, the script and the outcome (won, nobody, abandoned). The Admin tab lists them.
- `npm run smoke` runs an end-to-end test against a local worker started with `--var DEV_ADMIN:1 --var GEMINI_API_KEY:mock`.

## Deploy
The Worker serves the built SPA (static assets) and handles `/api/*`, so there is one deploy and one hostname.

1. `npx wrangler secret put GEMINI_API_KEY` (from `worker/`)
2. `npm run deploy -w worker` (builds `web/` first), then attach a custom domain to the Worker.
3. Zero Trust: self-hosted Access app on that hostname covering `/admin*` and `/api/admin/*`, one Allow policy for your Google email.
4. Set `CF_ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`) and `CF_ACCESS_AUD` (the app's AUD tag) in `worker/wrangler.jsonc`; keep `DEV_ADMIN` as `0`; deploy again.
