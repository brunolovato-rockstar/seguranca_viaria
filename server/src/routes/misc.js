import express from 'express';
import bcrypt from 'bcryptjs';
import { q } from '../db.js';
import { requireAdmin } from '../auth.js';
import { getCaptura, setCaptura, getStatus } from '../services/cameraManager.js';
import { config } from '../config.js';
import { loadCatalog } from '../services/ingest.js';

export const miscRouter = express.Router();

miscRouter.get('/captura', (req, res) => res.json({ ativa: getCaptura() }));
miscRouter.post('/captura', async (req, res) => {
  await setCaptura(req.body?.ativa !== false);
  res.json({ ativa: getCaptura() });
});

// Mapa: chave do Mapbox + câmeras com coordenadas, status e números do dia
miscRouter.get('/mapa', async (req, res) => {
  const cams = await q(`SELECT id, codigo, nome, finalidade, modelo, rodovia, km, pista, latitude, longitude, ativo FROM cameras ORDER BY codigo`);
  const hoje = await q(`SELECT e.camera_id, e.chave, a.nome, a.grupo, COUNT(*) n, SUM(e.status_validacao='aguardando' AND a.infracao=1) aguardando, MAX(e.ocorrido_em) ultimo
    FROM eventos e LEFT JOIN analiticos a ON a.chave=e.chave WHERE e.ocorrido_em >= CURDATE() GROUP BY e.camera_id, e.chave, a.nome, a.grupo ORDER BY n DESC`);
  const st = getStatus();
  res.json({
    token: config.mapboxToken,
    estilo: config.mapboxStyle,
    cameras: cams.map((c) => {
      const h = hoje.filter((x) => x.camera_id === c.id);
      return {
        ...c,
        latitude: c.latitude != null ? Number(c.latitude) : null,
        longitude: c.longitude != null ? Number(c.longitude) : null,
        status: st[c.id] || null,
        hoje: {
          total: h.reduce((t, x) => t + Number(x.n), 0),
          aguardando: h.reduce((t, x) => t + Number(x.aguardando || 0), 0),
          ultimo: h.reduce((m, x) => (!m || x.ultimo > m ? x.ultimo : m), null),
          analiticos: h.map((x) => ({ chave: x.chave, nome: x.nome, grupo: x.grupo, n: Number(x.n) })),
        },
      };
    }),
  });
});

miscRouter.get('/analiticos', async (req, res) => {
  const an = await q('SELECT * FROM analiticos ORDER BY destaque DESC, grupo, nome');
  const codes = await q('SELECT * FROM analitico_codigos ORDER BY codigo');
  const uso = await q('SELECT chave, COUNT(*) n FROM camera_analiticos GROUP BY chave');
  const hoje = await q('SELECT chave, COUNT(*) n FROM eventos WHERE ocorrido_em >= CURDATE() GROUP BY chave');
  for (const a of an) {
    a.codigos = codes.filter((c) => c.chave === a.chave).map((c) => c.codigo);
    a.cameras = uso.find((u) => u.chave === a.chave)?.n || 0;
    a.hoje = Number(hoje.find((h) => h.chave === a.chave)?.n || 0);
  }
  res.json(an);
});

/** Liga/desliga a GRAVAÇÃO de um analítico (desligado: o evento chega, mas não vira registro). */
miscRouter.put('/analiticos/:chave', requireAdmin, async (req, res) => {
  await q('UPDATE analiticos SET ativo=? WHERE chave=?', [req.body?.ativo ? 1 : 0, req.params.chave]);
  await loadCatalog(true);
  res.json({ ok: true });
});

miscRouter.get('/usuarios', requireAdmin, async (req, res) => {
  res.json(await q('SELECT id, usuario, nome, email, perfil, ativo, ultimo_acesso, criado_em, bloqueado_ate FROM usuarios ORDER BY usuario'));
});

miscRouter.post('/usuarios', requireAdmin, async (req, res) => {
  const { usuario, nome, email, perfil, senha } = req.body || {};
  if (!usuario || !senha || String(senha).length < 6) return res.status(400).json({ erro: 'Informe usuário e senha (mín. 6 caracteres).' });
  await q('INSERT INTO usuarios (usuario, nome, email, perfil, senha_hash) VALUES (?,?,?,?,?)',
    [String(usuario).toLowerCase(), nome || usuario, email || null, perfil === 'admin' ? 'admin' : 'operador', await bcrypt.hash(senha, 10)]);
  res.status(201).json({ ok: true });
});

miscRouter.get('/log-acesso', async (req, res) => {
  const own = req.user.perfil !== 'admin';
  res.json(await q(`SELECT * FROM log_acesso ${own ? 'WHERE usuario_id=?' : ''} ORDER BY criado_em DESC LIMIT 300`, own ? [req.user.id] : []));
});

miscRouter.get('/diagnostico/brutos/:id', async (req, res) => {
  const [r] = await q('SELECT * FROM eventos_brutos WHERE id=?', [req.params.id]);
  if (!r) return res.status(404).json({ erro: 'Não encontrado' });
  res.json(r);
});

/** Diagnóstico: tudo o que chegou da câmera (inclusive códigos ainda não mapeados). */
miscRouter.get('/diagnostico/brutos', async (req, res) => {
  const rows = await q(`SELECT b.id, b.camera_id, c.codigo camera_codigo, b.origem, b.codigo, b.recebido_em, b.imagens, b.evento_id, b.erro,
      LEFT(b.payload, ${req.query.full ? 60000 : 1500}) payload
    FROM eventos_brutos b LEFT JOIN cameras c ON c.id=b.camera_id ORDER BY b.id DESC LIMIT ?`, [Math.min(Number(req.query.limit) || 100, 500)]);
  const codigos = await q(`SELECT codigo, COUNT(*) n, MAX(recebido_em) ultimo, SUM(evento_id IS NULL) sem_mapa
    FROM eventos_brutos GROUP BY codigo ORDER BY ultimo DESC`);
  res.json({ rows, codigos });
});
