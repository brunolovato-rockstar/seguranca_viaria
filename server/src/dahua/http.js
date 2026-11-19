// Cliente HTTP para a câmera com autenticação Digest (RFC 2617) ou Basic.
// Guarda o "challenge" por câmera para não precisar de 2 requisições a cada snapshot.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const challenges = new Map();
// Trava por câmera: depois de senha errada ou bloqueio, para de tentar por um tempo
// (a câmera bloqueia o login após poucas tentativas erradas e cada tentativa conta).
const guards = new Map();
const authFails = new Map(); // falhas de senha seguidas por câmera
const AUTH_PAUSE_MS = 5 * 60000;
const SUSPENSO = Number.MAX_SAFE_INTEGER;

export class CameraError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code; // 'auth' | 'timeout' | 'network' | 'http'
    this.status = status;
  }
}

function parseOne(str) {
  const scheme = str.trim().split(/\s+/)[0].toLowerCase();
  const params = { scheme };
  str.replace(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g, (_, k, q, u) => { params[k.toLowerCase()] = q ?? u; return ''; });
  return params;
}

/** Lê os desafios do 401. Câmeras novas mandam 2 (SHA-256 e MD5): fica com o MD5 quando houver. */
function parseChallenge(res) {
  const list = res.headersDistinct?.['www-authenticate'] || [].concat(res.headers['www-authenticate'] || []);
  if (!list.length) return null;
  // um cabeçalho pode trazer mais de um "Digest ..." colado: separa
  const parts = list.flatMap((h) => String(h).split(/,\s*(?=(?:Digest|Basic)\s)/i));
  const all = parts.map(parseOne);
  const digests = all.filter((c) => c.scheme === 'digest');
  return digests.find((c) => !c.algorithm || /^md5$/i.test(c.algorithm))
    || digests.find((c) => /^sha-256$/i.test(c.algorithm))
    || digests[0] || all[0];
}

function buildAuth(ch, method, uri, user, pass) {
  if (ch.scheme === 'basic') return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  ch.nc = (ch.nc || 0) + 1;
  const nc = ch.nc.toString(16).padStart(8, '0');
  const cnonce = crypto.randomBytes(8).toString('hex');
  const H = /^sha-256/i.test(ch.algorithm || '') ? sha256 : md5;
  let ha1 = H(`${user}:${ch.realm}:${pass}`);
  if (/-sess$/i.test(ch.algorithm || '')) ha1 = H(`${ha1}:${ch.nonce}:${cnonce}`);
  const ha2 = H(`${method}:${uri}`);
  const qops = (ch.qop || '').split(',').map((s) => s.trim()).filter(Boolean);
  const qop = qops.includes('auth') ? 'auth' : qops[0];
  const response = qop ? H(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${ch.nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${ch.realm}", nonce="${ch.nonce}", uri="${uri}", response="${response}"`;
  if (ch.algorithm) h += `, algorithm=${ch.algorithm}`;
  if (ch.opaque) h += `, opaque="${ch.opaque}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  return h;
}

function raw(url, { method, headers, timeout }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method, headers, rejectUnauthorized: false }, (res) => {
      // queda de conexão no meio da resposta (túnel) não pode virar exceção solta e derrubar o servidor
      res.on('error', () => {});
      resolve(res);
    });
    req.setTimeout(timeout, () => req.destroy(new CameraError(`Sem resposta da câmera em ${timeout / 1000}s`, 'timeout')));
    req.on('error', (e) => reject(e instanceof CameraError ? e : new CameraError(`Falha de rede: ${e.code || e.message}`, 'network')));
    req.end();
  });
}

function readAll(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    // conexão caiu no meio da resposta (túnel instável, câmera reiniciou o socket…)
    const cut = (e) => reject(e instanceof CameraError ? e : new CameraError(`Conexão com a câmera interrompida no meio da transferência (${e?.code || 'aborted'})`, 'network'));
    res.on('error', cut);
    res.on('aborted', () => cut({ code: 'aborted' }));
  });
}

/**
 * Requisição à câmera.
 * cam = { url_base, usuario, senha }
 * stream=true devolve a resposta aberta (para MJPEG e fluxo de eventos).
 */
function lockedError(status, body) {
  const m = /RmLock"?\s*:\s*(\d+)/.exec(body);
  if (status !== 403 || !m) return null;
  const s = Number(m[1]);
  const e = new CameraError(`A câmera bloqueou o login por excesso de senhas erradas. Libera em ~${Math.max(1, Math.ceil(s / 60))} min. Confira a senha antes de tentar de novo.`, 'locked', 403);
  e.retryAfter = (s + 5) * 1000;
  return e;
}

function guardKey(cam) {
  try { return `${new URL(cam.url_base).origin}|${cam.usuario}`; } catch { return `${cam.url_base}|${cam.usuario}`; }
}

/** Libera a trava (ex.: depois de salvar uma senha nova). keepLock mantém o bloqueio da própria câmera. */
export function clearGuard(cam, { keepLock = true } = {}) {
  const k = guardKey(cam);
  const g = guards.get(k);
  if (g && (!keepLock || g.code !== 'locked')) guards.delete(k);
  authFails.set(k, 1); // senha nova: vale 1 tentativa; se a câmera recusar, suspende de novo
}

function setGuard(cam, err) {
  const k = guardKey(cam);
  if (err.code === 'locked') {
    // depois que a câmera liberar, só 1 tentativa: se a senha continuar errada, suspende
    authFails.set(k, Math.max(authFails.get(k) || 0, 1));
    guards.set(k, { until: Date.now() + err.retryAfter, msg: err.message, code: err.code });
    return;
  }
  // o aperto de mão já repetiu de forma serializada: recusa aqui é senha errada de verdade.
  // Para de tentar até alguém salvar/testar a senha (cada tentativa conta para o bloqueio da câmera).
  authFails.set(k, (authFails.get(k) || 0) + 1);
  guards.set(k, { until: SUSPENSO, code: 'auth',
    msg: 'A câmera recusou o usuário/senha. O sistema parou de tentar para não bloquear a câmera: corrija em Câmeras → Editar → Senha → Testar conexão.' });
}

// Um "aperto de mão" de autenticação por vez por câmera: quando dois pedidos pedem desafio ao
// mesmo tempo, a câmera invalida o nonce do primeiro e ele parecia "senha errada" sem ser.
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(key, run.catch(() => {}));
  return run;
}

async function finish(cam, res, stream) {
  if (stream) {
    if (res.statusCode >= 400) {
      const body = (await readAll(res)).toString('utf8').slice(0, 300);
      const le = lockedError(res.statusCode, body);
      if (le) { setGuard(cam, le); throw le; }
      throw new CameraError(`Câmera respondeu ${res.statusCode}: ${body}`, 'http', res.statusCode);
    }
    authFails.delete(guardKey(cam));
    return res;
  }
  const body = await readAll(res);
  if (res.statusCode >= 400) {
    const le = lockedError(res.statusCode, body.toString('utf8'));
    if (le) { setGuard(cam, le); throw le; }
    throw new CameraError(`Câmera respondeu ${res.statusCode}: ${body.toString('utf8').slice(0, 200)}`, 'http', res.statusCode);
  }
  authFails.delete(guardKey(cam));
  return { status: res.statusCode, headers: res.headers, body };
}

export async function camRequest(cam, path, { method = 'GET', timeout = 8000, stream = false } = {}) {
  const g = guards.get(guardKey(cam));
  if (g && g.until > Date.now()) {
    const e = new CameraError(g.msg, g.code, 403);
    e.retryAfter = Math.min(g.until - Date.now(), 10 * 60000); // limite: setTimeout não aceita valores gigantes
    throw e;
  }
  const url = new URL(path, cam.url_base.endsWith('/') ? cam.url_base : cam.url_base + '/');
  const key = `${url.origin}|${cam.usuario}`;
  const uri = url.pathname + url.search;
  const hdr = () => ({ Accept: '*/*', Connection: stream ? 'keep-alive' : 'close' });

  // 1) caminho rápido: desafio guardado (1 requisição só)
  const cached = challenges.get(key);
  if (cached) {
    const res = await raw(url, { method, headers: { ...hdr(), Authorization: buildAuth(cached, method, uri, cam.usuario, cam.senha || '') }, timeout });
    if (res.statusCode !== 401) return finish(cam, res, stream);
    res.resume();
    if (challenges.get(key) === cached) challenges.delete(key); // nonce venceu: pega outro abaixo
  }

  // 2) aperto de mão completo, um por vez por câmera; repete 1x antes de concluir que a senha está errada
  return withLock(key, async () => {
    let ultimo = '';
    const tentativas = cached ? 1 : 2; // no máximo 2 logins recusados por pedido (a câmera bloqueia em ~5)
    for (let tentativa = 0; tentativa < tentativas; tentativa++) {
      const r1 = await raw(url, { method, headers: hdr(), timeout });
      if (r1.statusCode !== 401) return finish(cam, r1, stream); // câmera sem autenticação
      r1.resume();
      const ch = parseChallenge(r1);
      if (!ch) break;
      const r2 = await raw(url, { method, headers: { ...hdr(), Authorization: buildAuth(ch, method, uri, cam.usuario, cam.senha || '') }, timeout });
      if (r2.statusCode !== 401) { challenges.set(key, ch); return finish(cam, r2, stream); }
      ultimo = (await readAll(r2).catch(() => Buffer.alloc(0))).toString('utf8').slice(0, 160);
      const le = lockedError(403, ultimo);
      if (le) { setGuard(cam, le); throw le; }
      await new Promise((ok) => setTimeout(ok, 400));
    }
    challenges.delete(key);
    console.warn(`[câmera ${url.host}] login recusado (401)${ultimo ? ': ' + ultimo.replace(/\s+/g, ' ') : ''}`);
    const e = new CameraError('A câmera recusou o usuário/senha. O sistema parou de tentar para não bloquear a câmera: corrija em Câmeras → Editar → Senha → Testar conexão.', 'auth', 401);
    setGuard(cam, e);
    throw e;
  });
}

/** Converte resposta "chave=valor" (padrão dos CGI) em objeto. */
export function parseKv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
