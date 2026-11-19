// Funções da câmera pelo HTTP API (CGI). Tudo passa pelo túnel/URL base cadastrada.
import { EventEmitter } from 'node:events';
import { camRequest, parseKv, CameraError } from './http.js';
import { MultipartParser, boundaryFrom } from './multipart.js';

/** Informações do equipamento — usado no "Testar conexão". */
export async function getInfo(cam) {
  const sys = parseKv((await camRequest(cam, '/cgi-bin/magicBox.cgi?action=getSystemInfo')).body.toString('utf8'));
  const info = { modelo: sys.deviceType || sys.updateSerial || null, serial: sys.serialNumber || null, hardware: sys.hardwareVersion || null };
  try {
    const v = parseKv((await camRequest(cam, '/cgi-bin/magicBox.cgi?action=getSoftwareVersion')).body.toString('utf8'));
    info.firmware = v.version || null;
  } catch { /* opcional */ }
  try {
    const t = parseKv((await camRequest(cam, '/cgi-bin/magicBox.cgi?action=getDeviceType')).body.toString('utf8'));
    info.modelo = t.type || info.modelo;
  } catch { /* opcional */ }
  try {
    const tm = parseKv((await camRequest(cam, '/cgi-bin/global.cgi?action=getCurrentTime')).body.toString('utf8'));
    info.hora_camera = tm.result || null;
  } catch { /* opcional */ }
  return info;
}

export async function snapshot(cam) {
  const path = `/cgi-bin/snapshot.cgi?channel=${cam.canal || 1}`;
  let r;
  try { r = await camRequest(cam, path, { timeout: 10000 }); } catch (e) {
    // queda de conexão no meio da foto: tenta mais uma vez antes de desistir
    if (!(e instanceof CameraError) || e.code !== 'network') throw e;
    await new Promise((ok) => setTimeout(ok, 400));
    r = await camRequest(cam, path, { timeout: 10000 });
  }
  const ct = String(r.headers['content-type'] || '');
  if (!ct.includes('image') && r.body[0] !== 0xff) throw new CameraError('A câmera não devolveu uma imagem', 'http', r.status);
  return r.body;
}

/** Stream MJPEG (precisa do substream da câmera configurado em MJPEG). */
export function mjpeg(cam) {
  return camRequest(cam, `/cgi-bin/mjpg/video.cgi?channel=${cam.canal || 1}&subtype=1`, { stream: true, timeout: 10000 });
}

// ---------- texto dos eventos ----------
/** "Events[0].TrafficCar.PlateNumber=ABC1234" -> objeto aninhado */
function setPath(obj, path, value) {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let o = obj;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) o[k] = value;
    else o = o[k] ?? (o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {});
    if (typeof o !== 'object' || o === null) o = {};
  });
}

export function parseEventText(text) {
  const flat = {};
  const nested = {};
  const list = [];
  // Formato do eventManager: Code=X;action=Pulse;index=0;data={...}
  const em = /Code=([^;\r\n]+);action=([^;\r\n]+);index=(\d+)(?:;data=)?/g;
  let m;
  while ((m = em.exec(text))) {
    let data = null;
    const start = em.lastIndex;
    if (text[start] === '{') {
      let depth = 0;
      for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) {
          try { data = JSON.parse(text.slice(start, i + 1)); } catch { /* ignora */ }
          em.lastIndex = i + 1;
          break;
        }
      }
    }
    list.push({ Code: m[1], Action: m[2], Index: Number(m[3]), Data: data });
  }
  if (list.length) return { format: 'eventManager', events: list };
  // Formato chave=valor do snapManager/attachFileProc
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    flat[k] = v;
    setPath(nested, k, v);
  }
  return { format: 'kv', flat, nested };
}

/** Separa Events[0], Events[1]… de uma mensagem chave=valor em eventos independentes (cada um re-indexado como Events[0]). */
export function splitEvents(parsed) {
  const f = parsed.flat;
  const idx = [...new Set(Object.keys(f).map((k) => /^Events\[(\d+)\]\./.exec(k)?.[1]).filter((x) => x != null))].sort((a, b) => a - b);
  if (idx.length <= 1) {
    const code = f['Events[0].EventBaseInfo.Code'] || f['Events[0].Code'] || f.Code || 'Desconhecido';
    const action = f['Events[0].EventBaseInfo.Action'] || f['Events[0].Action'] || 'Pulse';
    return [{ code, action, flat: f, data: parsed.nested }];
  }
  const comuns = Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith('Events[')));
  return idx.map((i) => {
    const sub = { ...comuns };
    for (const [k, v] of Object.entries(f)) if (k.startsWith(`Events[${i}].`)) sub['Events[0].' + k.slice(`Events[${i}].`.length)] = v;
    return {
      code: sub['Events[0].EventBaseInfo.Code'] || sub['Events[0].Code'] || 'Desconhecido',
      action: sub['Events[0].EventBaseInfo.Action'] || sub['Events[0].Action'] || 'Pulse',
      flat: sub,
      data: { Events: [parsed.nested?.Events?.[i]] },
    };
  });
}

/**
 * Abre o fluxo de eventos da câmera e emite:
 *  'open'      conectado
 *  'event'     { code, action, flat, data, images: [Buffer], rawText }
 *  'heartbeat'
 *  'close'     (err?)
 */
export function openEventStream(cam, { mode = 'attachFileProc', events = '[All]', heartbeat = 5 } = {}) {
  const em = new EventEmitter();
  let res = null;
  let closed = false;
  let pending = null;
  let pendingTimer = null;

  const flush = () => {
    clearTimeout(pendingTimer);
    if (!pending) return;
    const p = pending;
    pending = null;
    // Uma mensagem pode trazer vários eventos do mesmo veículo (Events[0], Events[1]…,
    // ex.: TrafficJunction + TrafficWithoutSafeBelt): vira um evento para cada, com as mesmas fotos.
    for (const ev of p.events) em.emit('event', { ...ev, images: p.images, rawText: p.rawText });
  };

  const path = mode === 'eventManager'
    ? `/cgi-bin/eventManager.cgi?action=attach&codes=${events}&heartbeat=${heartbeat}`
    : `/cgi-bin/snapManager.cgi?action=attachFileProc&Flags[0]=Event&Events=${events}&heartbeat=${heartbeat}`;

  camRequest(cam, path, { stream: true, timeout: 15000 })
    .then((r) => {
      if (closed) { r.destroy(); return; }
      res = r;
      res.socket?.setTimeout(heartbeat * 4000, () => res.destroy(new CameraError('Sem heartbeat da câmera', 'timeout')));
      em.emit('open');
      const parser = new MultipartParser(boundaryFrom(res.headers['content-type']));
      parser.on('part', ({ headers, body }) => {
        const ct = headers['content-type'] || '';
        if (ct.includes('image') || (body[0] === 0xff && body[1] === 0xd8)) {
          if (pending) pending.images.push(body);
          return;
        }
        const text = body.toString('utf8').trim();
        if (!text || /^heartbeat/i.test(text)) { flush(); em.emit('heartbeat'); return; }
        flush();
        const parsed = parseEventText(text);
        if (parsed.format === 'eventManager') {
          for (const ev of parsed.events) em.emit('event', { code: ev.Code, action: ev.Action, flat: {}, data: ev.Data || {}, images: [], rawText: text });
          return;
        }
        pending = { events: splitEvents(parsed), images: [], rawText: text };
        // As imagens vêm logo depois do texto e podem demorar pelo túnel (fotos de 1–2 MB):
        // o evento só é fechado no próximo texto/heartbeat ou após 12 s sem dados.
        pendingTimer = setTimeout(flush, 12000);
      });
      res.on('data', (c) => {
        if (pending) { clearTimeout(pendingTimer); pendingTimer = setTimeout(flush, 12000); }
        parser.feed(c);
      });
      res.on('end', () => { flush(); if (!closed) em.emit('close'); });
      res.on('error', (e) => { flush(); if (!closed) em.emit('close', e); });
    })
    .catch((e) => { if (!closed) em.emit('close', e); });

  em.stop = () => { closed = true; clearTimeout(pendingTimer); res?.destroy(); };
  return em;
}
