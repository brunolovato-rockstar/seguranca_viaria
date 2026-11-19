// Sistema: estado do servidor, log ao vivo e ações de manutenção (só administrador).
// Os comandos de VPN e de reinício vêm do .env — a tela nunca manda comando livre.
import express from 'express';
import os from 'node:os';
import fs from 'node:fs';
import net from 'node:net';
import { exec, spawn } from 'node:child_process';
import { pool, q } from '../db.js';
import { requireAdmin } from '../auth.js';
import { lerLogs, arquivoHoje } from '../services/logbuf.js';
import { getStatus, reconectar, getCaptura } from '../services/cameraManager.js';

export const sistemaRouter = express.Router();
sistemaRouter.use(requireAdmin);

const inicio = Date.now();
const VPN_RESTART = process.env.VPN_RESTART_CMD || '';
const VPN_STATUS = process.env.VPN_STATUS_CMD || '';
const SERVER_RESTART = process.env.SERVER_RESTART_CMD || '';
const RESTART_BY_EXIT = process.env.RESTART_BY_EXIT === '1';
const quem = (req) => `${req.user?.usuario || '?'} (${req.ip})`;

function rodar(cmd, timeout = 90000) {
  return new Promise((ok) => {
    const t0 = Date.now();
    exec(cmd, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      ok({ ok: !err, codigo: err?.code ?? 0, ms: Date.now() - t0, saida: `${stdout || ''}${stderr || ''}`.trim().slice(-4000), erro: err && !stdout && !stderr ? err.message : undefined });
    });
  });
}

/** Testa se a porta da câmera responde (pela VPN/túnel), sem fazer login. */
function testarRede(url) {
  return new Promise((ok) => {
    let u;
    try { u = new URL(url); } catch { ok({ ok: false, erro: 'URL inválida' }); return; }
    const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    const t0 = Date.now();
    const s = net.connect({ host: u.hostname, port, timeout: 4000 });
    const fim = (r) => { s.destroy(); ok({ host: `${u.hostname}:${port}`, ...r }); };
    s.on('connect', () => fim({ ok: true, ms: Date.now() - t0 }));
    s.on('timeout', () => fim({ ok: false, erro: 'sem resposta em 4 s' }));
    s.on('error', (e) => fim({ ok: false, erro: e.code || e.message }));
  });
}

sistemaRouter.get('/status', async (req, res) => {
  const t0 = Date.now();
  let banco;
  try { await pool.query('SELECT 1'); banco = { ok: true, ms: Date.now() - t0 }; } catch (e) { banco = { ok: false, erro: e.message }; }
  const cams = banco.ok ? await q('SELECT id, codigo, nome, url_base, ativo FROM cameras ORDER BY codigo') : [];
  const st = getStatus();
  const cameras = await Promise.all(cams.map(async (c) => ({ ...c, status: st[c.id] || null, rede: c.ativo ? await testarRede(c.url_base) : null })));
  const vpn = VPN_STATUS ? await rodar(VPN_STATUS, 10000) : null;
  const m = process.memoryUsage();
  res.json({
    servidor: {
      inicio, uptime_s: Math.round((Date.now() - inicio) / 1000), pid: process.pid, node: process.version,
      so: `${os.type()} ${os.release()}`, host: os.hostname(), memoria_mb: Math.round(m.rss / 1048576),
      carga: os.loadavg()[0], captura: getCaptura(),
    },
    banco,
    cameras,
    vpn: { configurado: !!VPN_RESTART, status: vpn },
    acoes: { vpn: !!VPN_RESTART, reiniciar: SERVER_RESTART ? 'comando' : RESTART_BY_EXIT ? 'saida' : null },
  });
});

sistemaRouter.get('/logs', (req, res) => {
  res.json(lerLogs({ desde: Number(req.query.desde) || 0, limite: Math.min(Number(req.query.limite) || 500, 3000), nivel: req.query.nivel || '' }));
});

sistemaRouter.get('/logs/download', (req, res) => {
  const f = arquivoHoje();
  res.setHeader('Content-Disposition', `attachment; filename="${f.split(/[\\/]/).pop()}"`);
  if (fs.existsSync(f)) return res.type('text/plain').send(fs.readFileSync(f));
  res.type('text/plain').send(lerLogs({ limite: 3000 }).itens.map((x) => `${new Date(x.ts).toISOString()} ${x.nivel} ${x.msg}`).join('\n'));
});

sistemaRouter.post('/acoes/reconectar', async (req, res) => {
  const id = req.body?.camera_id ? Number(req.body.camera_id) : null;
  console.warn(`[ação] ${quem(req)}: reconectar ${id ? `câmera #${id}` : 'todas as câmeras'}`);
  await reconectar(id);
  res.json({ ok: true });
});

sistemaRouter.post('/acoes/testar-rede', async (req, res) => {
  const cams = await q('SELECT codigo, url_base FROM cameras WHERE ativo=1');
  const r = await Promise.all(cams.map(async (c) => ({ codigo: c.codigo, ...(await testarRede(c.url_base)) })));
  for (const x of r) console.log(`[rede] ${x.codigo} ${x.host}: ${x.ok ? `ok em ${x.ms} ms` : `FALHOU (${x.erro})`}`);
  res.json(r);
});

sistemaRouter.post('/acoes/vpn', async (req, res) => {
  if (!VPN_RESTART) return res.status(400).json({ erro: 'Comando da VPN não configurado (VPN_RESTART_CMD no server/.env).' });
  console.warn(`[ação] ${quem(req)}: reiniciar VPN → ${VPN_RESTART}`);
  const r = await rodar(VPN_RESTART);
  console[r.ok ? 'log' : 'error'](`[vpn] ${r.ok ? 'reiniciada' : 'falhou'} em ${r.ms} ms${r.saida ? `\n${r.saida}` : ''}${r.erro ? ` · ${r.erro}` : ''}`);
  // dá alguns segundos para a VPN subir e reconecta as câmeras
  setTimeout(() => reconectar(null).catch(() => {}), 8000);
  res.json(r);
});

sistemaRouter.post('/acoes/reiniciar-servidor', (req, res) => {
  if (SERVER_RESTART) {
    console.warn(`[ação] ${quem(req)}: reiniciar servidor → ${SERVER_RESTART}`);
    res.json({ ok: true, modo: 'comando' });
    setTimeout(() => spawn(SERVER_RESTART, { shell: true, detached: true, stdio: 'ignore' }).unref(), 500);
    return undefined;
  }
  if (RESTART_BY_EXIT) {
    console.warn(`[ação] ${quem(req)}: reiniciar servidor (o serviço do sistema sobe de novo)`);
    res.json({ ok: true, modo: 'saida' });
    setTimeout(() => process.exit(0), 800);
    return undefined;
  }
  return res.status(400).json({ erro: 'Reinício pela tela desativado: no Linux, rode como serviço (systemd) e defina RESTART_BY_EXIT=1 no server/.env.' });
});
