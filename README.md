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
npm run dev:worker   # :8787
npm run dev:web      # :5173, proxies /api
```
Open `/admin` to create a lobby, `/lobby/<id>` on other tabs/phones to join.

## Deploy
1. `wrangler secret put GEMINI_API_KEY`
2. Set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`; keep `DEV_ADMIN` as `0`.
3. Zero Trust Access app covering `/admin*` and `/api/admin/*` (Google login, your email only).
4. `npm run deploy -w worker`; deploy `web/dist` to Pages and route `/api/*` to the Worker on the same domain.
