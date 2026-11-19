// Mantém uma conexão de eventos aberta por câmera, com reconexão automática,
// e um cache de snapshot para o "ao vivo" (várias telas olhando = 1 requisição à câmera).
import { q, one } from '../db.js';
import { decrypt } from '../crypto.js';
import { config } from '../config.js';
import { openEventStream, snapshot as camSnapshot } from '../dahua/client.js';
import { clearGuard } from '../dahua/http.js';
import { fromHttpApi } from '../dahua/normalize.js';
import { ingest } from './ingest.js';
import { broadcast } from '../ws.js';
import { registerStream } from './go2rtc.js';

import fs from 'node:fs';
import path from 'node:path';

const streams = new Map(); // id -> { em, timer, backoff }

// ---- captura de eventos liga/desliga (para testes, sem encher o banco) ----
const settingsFile = () => path.join(config.storageDir, 'config.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
let capturaAtiva = readSettings().capturaAtiva !== false;
export const getCaptura = () => capturaAtiva;
export async function setCaptura(ativa) {
  capturaAtiva = !!ativa;
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), capturaAtiva }, null, 2)); } catch { /* ok */ }
  broadcast('captura', { ativa: capturaAtiva });
  await startAll(); // reabre ou fecha os fluxos de eventos
}
const status = new Map(); // id -> { estado, desde, ultimoEvento, ultimoHeartbeat, erro, eventos }
const snaps = new Map(); // id -> { ts, buf, pending }

export async function loadCamera(id) {
  const c = await one('SELECT * FROM cameras WHERE id=?', [id]);
  if (!c) return null;
  c.senha = decrypt(c.senha_enc);
  return c;
}

function setStatus(id, patch) {
  const s = { ...(status.get(id) || { eventos: 0 }), ...patch };
  status.set(id, s);
  broadcast('camera_status', { camera_id: id, status: s });
}

export function getStatus() {
  return Object.fromEntries([...status.entries()]);
}

function connect(cam) {
  const st = streams.get(cam.id) || { backoff: 5000 };
  streams.set(cam.id, st);
  setStatus(cam.id, { estado: 'conectando', erro: null });
  const em = openEventStream(cam, { mode: cam.modo_eventos, events: config.cameraEvents });
  st.em = em;
  em.on('open', () => { st.backoff = 5000; console.log(`[${cam.codigo}] eventos conectados (${cam.modo_eventos})`); setStatus(cam.id, { estado: 'online', desde: Date.now(), erro: null }); });
  em.on('heartbeat', () => setStatus(cam.id, { estado: 'online', ultimoHeartbeat: Date.now() }));
  em.on('event', async (raw) => {
    if (raw.action === 'Stop') return; // evita duplicar Start/Stop
    try {
      const ev = fromHttpApi(raw);
      let imagens = raw.images.map((buf, i) => ({ tipo: i === 0 ? 'evento' : 'placa', buf }));
      // Câmera não mandou foto junto (eventManager, ou foto perdida no caminho):
      // tira um snapshot na hora do evento para o registro não ficar sem imagem
      if (!imagens.length) {
        try { imagens = [{ tipo: 'outro', buf: await getSnapshot(cam.id, true) }]; } catch { /* sem imagem */ }
      }
      ev.dados = raw.data;
      const reg = await ingest({ camera: cam, origem: 'http_api', ev, imagens, raw: raw.rawText });
      if (reg && reg.chave !== 'anpr') console.log(`[${cam.codigo}] ${reg.analitico_nome || reg.chave} · ${reg.placa || 'sem placa'} · registro #${reg.id} · ${imagens.length} foto(s)`);
      else if (!reg) console.log(`[${cam.codigo}] evento ${raw.code} recebido sem virar registro (sem mapeamento ou analítico desligado)`);
      const s = status.get(cam.id) || {};
      setStatus(cam.id, { ultimoEvento: Date.now(), eventos: (s.eventos || 0) + 1 });
    } catch (e) {
      console.error(`[${cam.codigo}] erro ao gravar evento:`, e.message);
    }
  });
  em.on('close', (err) => {
    if (st.stopped) return;
    setStatus(cam.id, { estado: 'erro', erro: err?.message || 'Conexão de eventos encerrada' });
        // senha errada ou câmera bloqueada: espera o tempo da trava em vez de insistir
    const wait = err?.code === 'locked' || err?.code === 'auth' ? Math.max(err.retryAfter || 60000, 60000) : st.backoff;
    console.warn(`[${cam.codigo}] eventos desconectados: ${err?.message || 'fim do fluxo'} · nova tentativa em ${Math.round(wait / 1000)}s`);
    st.timer = setTimeout(() => connect(cam), wait);
    if (wait === st.backoff) st.backoff = Math.min(st.backoff * 2, 60000);
  });
}

export async function startCamera(id) {
  stopCamera(id);
  const cam = await loadCamera(id);
  if (!cam || !cam.ativo) { setStatus(id, { estado: 'desligada' }); return; }
  if (cam.rtsp_url) {
    registerStream(cam, { replace: true })
      .then(() => console.log(`[${cam.codigo}] vídeo registrado no go2rtc`))
      .catch((e) => console.warn(`[${cam.codigo}] go2rtc indisponível (${e.message}) — vídeo RTSP desligado, snapshot continua`));
  }
  if (cam.acesso === 'itsapi_push') { setStatus(id, { estado: 'aguardando push', erro: null }); return; }
  if (cam.acesso === 'sdk') { setStatus(id, { estado: 'sdk (fase futura)', erro: null }); return; }
  if (cam.modo_eventos === 'desligado') { setStatus(id, { estado: 'eventos desligados', erro: null }); return; }
  if (!capturaAtiva) { setStatus(id, { estado: 'captura pausada', erro: null }); return; }
  console.log(`[${cam.codigo}] conectando eventos em ${cam.url_base} (${cam.modo_eventos})`);
  connect(cam);
}

export function stopCamera(id) {
  const st = streams.get(id);
  if (!st) return;
  st.stopped = true;
  clearTimeout(st.timer);
  st.em?.stop();
  streams.delete(id);
  snaps.delete(id);
}

/** Reconecta uma câmera (ou todas): libera a pausa de senha (o bloqueio da própria câmera continua respeitado). */
export async function reconectar(id = null) {
  const ids = id ? [id] : (await q('SELECT id FROM cameras WHERE ativo=1')).map((c) => c.id);
  for (const i of ids) {
    const cam = await loadCamera(i);
    if (cam) clearGuard(cam);
    await startCamera(i);
  }
}

export async function startAll() {
  const cams = await q('SELECT id FROM cameras WHERE ativo=1');
  for (const c of cams) await startCamera(c.id);
}

/** Snapshot com cache curto por câmera. */
export async function getSnapshot(id, fresh = false) {
  const s = snaps.get(id) || {};
  if (!fresh && s.buf && Date.now() - s.ts < config.snapshotMinIntervalMs) return s.buf;
  if (s.pending) return s.pending;
  const cam = await loadCamera(id);
  if (!cam) throw new Error('Câmera não encontrada');
  s.pending = camSnapshot(cam)
    .then((buf) => { s.buf = buf; s.ts = Date.now(); return buf; })
    .catch((e) => {
      // falha pontual: no Ao Vivo devolve a última foto (até 15 s) em vez de piscar erro
      if (!fresh && s.buf && Date.now() - s.ts < 15000 && e.code === 'network') return s.buf;
      throw e;
    })
    .finally(() => { s.pending = null; });
  snaps.set(id, s);
  return s.pending;
}
