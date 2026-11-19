// Acesso à API do Node. O token fica no navegador (localStorage ou sessionStorage).
const KEY = 'sv_token';

export function getToken() {
  return localStorage.getItem(KEY) || sessionStorage.getItem(KEY);
}
export function setToken(t, manter) {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
  if (t) (manter ? localStorage : sessionStorage).setItem(KEY, t);
}

export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && path !== '/auth/login') {
    setToken(null);
    window.dispatchEvent(new Event('sv-logout'));
  }
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(data?.erro || `Erro ${r.status}`);
  return data;
}

/** URL de mídia com token (para <img>, que não manda cabeçalho). */
export const media = (url) => (url ? `${url}${url.includes('?') ? '&' : '?'}token=${getToken()}` : '');

/** WebSocket com reconexão. Chama onMsg({type,...}). */
export function connectWs(onMsg) {
  let ws;
  let stop = false;
  let timer;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${getToken()}`);
    ws.onmessage = (m) => { try { onMsg(JSON.parse(m.data)); } catch { /* ignora */ } };
    ws.onclose = () => { if (!stop) timer = setTimeout(open, 3000); };
  };
  open();
  return () => { stop = true; clearTimeout(timer); ws?.close(); };
}
