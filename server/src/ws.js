// WebSocket: empurra eventos novos e status das câmeras para o front em tempo real.
import { WebSocketServer } from 'ws';
import { verifyToken } from './auth.js';

let wss = null;

export function attachWs(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket, req) => {
    const token = new URL(req.url, 'http://x').searchParams.get('token');
    if (!verifyToken(token)) { socket.close(4001, 'nao autorizado'); return; }
    socket.send(JSON.stringify({ type: 'hello', ts: Date.now() }));
  });
}

export function broadcast(type, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ type, ...payload });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
