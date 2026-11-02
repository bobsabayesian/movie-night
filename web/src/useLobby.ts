import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, GameState, ServerMessage } from '../../shared/types';

export type Conn = 'connecting' | 'open' | 'closed' | 'kicked' | 'ended';

const tokenKey = (id: string) => `scene-sync:${id}:token`;

export function useLobby(lobbyId: string, name: string | null, color: string | null, admin: boolean) {
  const [state, setState] = useState<GameState | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [conn, setConn] = useState<Conn>('connecting');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!name) return;
    let stopped = false;
    let retry = 0;
    let timer: number | undefined;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const path = admin ? `/api/admin/lobby/${lobbyId}/ws` : `/api/lobby/${lobbyId}/ws`;
      const ws = new WebSocket(`${proto}://${location.host}${path}`);
      wsRef.current = ws;
      setConn('connecting');

      ws.onopen = () => {
        retry = 0;
        const token = sessionStorage.getItem(tokenKey(lobbyId)) ?? undefined;
        ws.send(JSON.stringify({ type: 'join', name, color: color ?? undefined, token } satisfies ClientMessage));
      };
      ws.onmessage = (ev) => {
        const msg: ServerMessage = JSON.parse(ev.data);
        if (msg.type === 'joined') {
          sessionStorage.setItem(tokenKey(lobbyId), msg.token);
          setMe(msg.playerId);
          setConn('open');
          setError(null);
        } else if (msg.type === 'state') {
          setState(msg.state);
          if (msg.state.ended) {
            stopped = true;
            setConn('ended');
          }
        } else if (msg.type === 'error') {
          setError(msg.message);
        } else if (msg.type === 'kicked') {
          stopped = true;
          sessionStorage.removeItem(tokenKey(lobbyId));
          setConn('kicked');
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setConn('closed');
        timer = window.setTimeout(connect, Math.min(1000 * 2 ** retry++, 8000));
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [lobbyId, name, color, admin]);

  const send = useCallback((msg: ClientMessage) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  return { state, me, conn, error, send };
}
