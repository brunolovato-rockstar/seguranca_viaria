// Vídeo ao vivo de verdade: o go2rtc lê o RTSP da câmera e entrega ao navegador (WebRTC/MSE).
// O servidor só registra no go2rtc um "stream" por câmera (nome = código da câmera, ex.: CAM-01),
// com usuário/senha injetados — a senha não aparece no front.
import { config } from '../config.js';

const base = () => config.go2rtcUrl.replace(/\/+$/, '');

export function rtspWithAuth(cam) {
  if (!cam.rtsp_url) return null;
  if (/^rtsp:\/\/[^/]*@/.test(cam.rtsp_url)) return cam.rtsp_url; // já tem credencial
  const enc = encodeURIComponent; // senha com @ ou : precisa ir codificada
  return cam.rtsp_url.replace(/^rtsp:\/\//, `rtsp://${enc(cam.usuario || 'admin')}:${enc(cam.senha || '')}@`);
}

async function call(method, qs) {
  const r = await fetch(`${base()}/api/streams?${new URLSearchParams(qs)}`, { method, signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`go2rtc respondeu ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
}

export async function listStreams() {
  return call('GET', {});
}

/** Cria/atualiza o stream da câmera no go2rtc. Retorna o nome do stream ou null. */
export async function registerStream(cam, { replace = false } = {}) {
  const src = rtspWithAuth(cam);
  if (!src) return null;
  const name = cam.codigo;
  const streams = await listStreams();
  if (streams && streams[name]) {
    if (!replace) return name;
    await call('DELETE', { src: name });
  }
  await call('PUT', { name, src });
  return name;
}

export async function removeStream(cam) {
  try { await call('DELETE', { src: cam.codigo }); } catch { /* go2rtc fora do ar */ }
}

/** Situação do vídeo de uma câmera (para o front decidir o que mostrar). */
export async function videoStatus(cam) {
  if (!cam.rtsp_url) return { disponivel: false, motivo: 'Câmera sem URL RTSP cadastrada.' };
  try {
    const streams = await listStreams();
    if (!streams?.[cam.codigo]) await registerStream(cam);
    return { disponivel: true, stream: cam.codigo, go2rtc_url: base() };
  } catch (e) {
    return { disponivel: false, motivo: `go2rtc não respondeu em ${base()} (${e.message}). Ele está rodando?` };
  }
}
