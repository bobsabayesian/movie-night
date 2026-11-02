import { isAdminRequest } from './access';
import type { Env } from './env';
import { listRounds } from './ledger';

export { LobbyDO } from './lobby';

const LOBBY_ID = /^[A-Za-z0-9-]{6,64}$/;

function forwardToLobby(request: Request, env: Env, id: string, admin: boolean): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return Promise.resolve(new Response('Expected websocket', { status: 426 }));
  }
  const headers = new Headers(request.headers);
  headers.delete('x-admin'); // never trust a client-supplied value
  headers.set('x-lobby-id', id);
  if (admin) headers.set('x-admin', '1');
  const stub = env.LOBBY.get(env.LOBBY.idFromName(id));
  return stub.fetch(new Request(request, { headers }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Admin routes sit behind Cloudflare Zero Trust; the JWT is re-verified here.
    if (path.startsWith('/api/admin/')) {
      if (!(await isAdminRequest(request, env))) {
        return new Response('Forbidden', { status: 403 });
      }
      if (request.method === 'POST' && path === '/api/admin/lobby') {
        const id = crypto.randomUUID().slice(0, 8);
        return Response.json({ id, joinPath: `/lobby/${id}` });
      }
      if (request.method === 'GET' && path === '/api/admin/log') {
        return Response.json(await listRounds(env));
      }
      const m = path.match(/^\/api\/admin\/lobby\/([^/]+)\/ws$/);
      if (m && LOBBY_ID.test(m[1])) return forwardToLobby(request, env, m[1], true);
      return new Response('Not found', { status: 404 });
    }

    const info = path.match(/^\/api\/lobby\/([^/]+)\/info$/);
    if (info && LOBBY_ID.test(info[1])) {
      return env.LOBBY.get(env.LOBBY.idFromName(info[1])).fetch(new Request('https://lobby/info'));
    }

    const m = path.match(/^\/api\/lobby\/([^/]+)\/ws$/);
    if (m && LOBBY_ID.test(m[1])) return forwardToLobby(request, env, m[1], false);

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
