import type { Env } from './env';

interface Jwk extends JsonWebKey {
  kid?: string;
}

let jwksCache: { at: number; keys: Jwk[] } | null = null;

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function getKeys(env: Env): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < 10 * 60_000) return jwksCache.keys;
  const res = await fetch(`https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Cannot fetch Access certs');
  const { keys } = (await res.json()) as { keys: Jwk[] };
  jwksCache = { at: Date.now(), keys };
  return keys;
}

/** True when the request carries a valid Cloudflare Access JWT for our app. */
export async function isAdminRequest(request: Request, env: Env): Promise<boolean> {
  if (env.DEV_ADMIN === '1') return true;
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return false;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return false;
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return false;
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    if (header.alg !== 'RS256') return false;
    const jwk = (await getKeys(env)).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) return false;
    const aud: string[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    return (
      aud.includes(env.CF_ACCESS_AUD) &&
      payload.iss === `https://${env.CF_ACCESS_TEAM_DOMAIN}` &&
      typeof payload.exp === 'number' &&
      payload.exp * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}
