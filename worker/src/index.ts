import { isAdminRequest } from './access';
import type { Env } from './env';

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
      const m = path.match(/^\/api\/admin\/lobby\/([^/]+)\/ws$/);
      if (m && LOBBY_ID.test(m[1])) return forwardToLobby(request, env, m[1], true);
      return new Response('Not found', { status: 404 });
    }

    const m = path.match(/^\/api\/lobby\/([^/]+)\/ws$/);
    if (m && LOBBY_ID.test(m[1])) return forwardToLobby(request, env, m[1], false);

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
