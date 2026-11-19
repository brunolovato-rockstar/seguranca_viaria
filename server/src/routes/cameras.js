import express from 'express';
import { q, one } from '../db.js';
import { encrypt } from '../crypto.js';
import { requireAdmin } from '../auth.js';
import { getInfo, mjpeg } from '../dahua/client.js';
import { CameraError, clearGuard } from '../dahua/http.js';
import { loadCamera, startCamera, stopCamera, getStatus, getSnapshot } from '../services/cameraManager.js';
import { videoStatus } from '../services/go2rtc.js';

export const camerasRouter = express.Router();

const PUBLIC = `id, codigo, nome, finalidade, url_base, usuario, acesso, modo_eventos, canal, faixas, rtsp_url, device_id, modelo, serial,
  firmware, rodovia, km, pista, latitude, longitude, ativo, criado_em, atualizado_em, (senha_enc IS NOT NULL) AS tem_senha`;

async function withAnalytics(rows) {
  if (!rows.length) return rows;
  const ca = await q('SELECT camera_id, chave FROM camera_analiticos');
  for (const r of rows) r.analiticos = ca.filter((x) => x.camera_id === r.id).map((x) => x.chave);
  return rows;
}

const camErr = (res, e) => {
  if (e instanceof CameraError) return res.status(502).json({ erro: e.message, tipo: e.code, tentar_em_ms: e.retryAfter || null });
  console.error(`[câmera] ${e.code || ''} ${e.message}`);
  return res.status(500).json({ erro: e.message });
};

camerasRouter.get('/', async (req, res) => {
  res.json(await withAnalytics(await q(`SELECT ${PUBLIC} FROM cameras ORDER BY codigo`)));
});

camerasRouter.get('/status', (req, res) => res.json(getStatus()));

camerasRouter.get('/:id', async (req, res) => {
  const c = await one(`SELECT ${PUBLIC} FROM cameras WHERE id=?`, [req.params.id]);
  if (!c) return res.status(404).json({ erro: 'Câmera não encontrada' });
  res.json((await withAnalytics([c]))[0]);
});

const FIELDS = ['codigo', 'nome', 'finalidade', 'url_base', 'usuario', 'acesso', 'modo_eventos', 'canal', 'faixas', 'rtsp_url', 'device_id',
  'rodovia', 'km', 'pista', 'latitude', 'longitude', 'ativo'];

function pickBody(b) {
  const o = {};
  for (const f of FIELDS) if (b[f] !== undefined) o[f] = b[f] === '' ? null : b[f];
  if (o.url_base) o.url_base = String(o.url_base).trim().replace(/\/+#?\/?$/, '').replace(/\/#$/, '');
  return o;
}

async function saveAnalytics(id, list) {
  if (!Array.isArray(list)) return;
  await q('DELETE FROM camera_analiticos WHERE camera_id=?', [id]);
  for (const k of list) await q('INSERT IGNORE INTO camera_analiticos (camera_id, chave) VALUES (?,?)', [id, k]);
}

camerasRouter.post('/', requireAdmin, async (req, res) => {
  const o = pickBody(req.body);
  if (!o.nome || !o.url_base) return res.status(400).json({ erro: 'Informe nome e URL da câmera.' });
  if (!o.codigo) {
    const n = (await one('SELECT COUNT(*) n FROM cameras')).n + 1;
    o.codigo = 'CAM-' + String(n).padStart(2, '0');
  }
  if (req.body.senha) o.senha_enc = encrypt(req.body.senha);
  const cols = Object.keys(o);
  const r = await q(`INSERT INTO cameras (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, Object.values(o));
  await saveAnalytics(r.insertId, req.body.analiticos);
  startCamera(r.insertId);
  res.status(201).json({ id: r.insertId });
});

camerasRouter.put('/:id', requireAdmin, async (req, res) => {
  const o = pickBody(req.body);
  const antes = await loadCamera(req.params.id);
  if (antes && (req.body.senha || req.body.usuario)) clearGuard(antes);
  if (req.body.senha) o.senha_enc = encrypt(req.body.senha);
  const cols = Object.keys(o);
  if (cols.length) await q(`UPDATE cameras SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`, [...Object.values(o), req.params.id]);
  await saveAnalytics(req.params.id, req.body.analiticos);
  startCamera(Number(req.params.id));
  res.json({ ok: true });
});

camerasRouter.delete('/:id', requireAdmin, async (req, res) => {
  stopCamera(Number(req.params.id));
  await q('DELETE FROM cameras WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

/** Testa conexão com dados do formulário (antes de salvar) ou de uma câmera salva. */
camerasRouter.post('/testar', async (req, res) => {
  try {
    let cam;
    if (req.body.id) {
      cam = await loadCamera(req.body.id);
      if (req.body.url_base) cam.url_base = req.body.url_base;
      if (req.body.senha) cam.senha = req.body.senha;
      if (req.body.usuario) cam.usuario = req.body.usuario;
    } else {
      cam = { url_base: req.body.url_base, usuario: req.body.usuario || 'admin', senha: req.body.senha || '', canal: req.body.canal || 1 };
    }
    if (!cam?.url_base) return res.status(400).json({ erro: 'Informe a URL da câmera.' });
    clearGuard(cam); // teste pedido pelo usuário: permite 1 tentativa (o bloqueio da própria câmera continua respeitado)
    const t0 = Date.now();
    const info = await getInfo(cam);
    info.latencia_ms = Date.now() - t0;
    if (req.body.id) {
      await q('UPDATE cameras SET modelo=COALESCE(?,modelo), serial=COALESCE(?,serial), firmware=COALESCE(?,firmware) WHERE id=?',
        [info.modelo, info.serial, info.firmware, req.body.id]);
    }
    res.json({ ok: true, info });
  } catch (e) { camErr(res, e); }
});

camerasRouter.get('/:id/snapshot', async (req, res) => {
  try {
    const buf = await getSnapshot(Number(req.params.id));
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }).send(buf);
  } catch (e) { camErr(res, e); }
});

camerasRouter.get('/:id/video', async (req, res) => {
  const cam = await loadCamera(req.params.id);
  if (!cam) return res.status(404).json({ erro: 'Câmera não encontrada' });
  res.json(await videoStatus(cam));
});

camerasRouter.get('/:id/mjpeg', async (req, res) => {
  try {
    const cam = await loadCamera(req.params.id);
    if (!cam) return res.status(404).end();
    const up = await mjpeg(cam);
    res.writeHead(200, { 'Content-Type': up.headers['content-type'] || 'multipart/x-mixed-replace', 'Cache-Control': 'no-store' });
    up.on('error', () => res.end());
    up.on('aborted', () => res.end());
    up.pipe(res);
    // navegador fechou/trocou a imagem: encerra o MJPEG na câmera (ela aceita poucos fluxos ao mesmo tempo)
    req.on('close', () => up.destroy());
    res.on('close', () => up.destroy());
  } catch (e) { camErr(res, e); }
});
