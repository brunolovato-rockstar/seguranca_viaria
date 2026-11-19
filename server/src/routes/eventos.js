import express from 'express';
import { q, one } from '../db.js';
import { EVENT_SELECT, attachImages, getEvento } from '../services/ingest.js';
import { broadcast } from '../ws.js';

export const eventosRouter = express.Router();

const PLACA_RX = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

/** Lista com filtros: de, ate, camera, chave(s), excluir, placa, validacao, prf, tipo_veiculo, marca, cor, faixa, sentido, vel_min, vel_max, placa_corrigida, page, size */
eventosRouter.get('/', async (req, res) => {
  const w = [];
  const p = [];
  const f = req.query;
  if (f.de) { w.push('e.ocorrido_em >= ?'); p.push(`${f.de} 00:00:00`); }
  if (f.ate) { w.push('e.ocorrido_em <= ?'); p.push(`${f.ate} 23:59:59.999`); }
  if (f.camera) { w.push('e.camera_id = ?'); p.push(f.camera); }
  if (f.chave) { w.push('e.chave = ?'); p.push(f.chave); }
  const lista = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
  if (f.chaves) { const l = lista(f.chaves); if (l.length) { w.push(`e.chave IN (${l.map(() => '?').join(',')})`); p.push(...l); } }
  if (f.excluir) { const l = lista(f.excluir); if (l.length) { w.push(`(e.chave IS NULL OR e.chave NOT IN (${l.map(() => '?').join(',')}))`); p.push(...l); } }
  if (f.placa) { w.push('e.placa LIKE ?'); p.push(`%${String(f.placa).toUpperCase().replace(/[^A-Z0-9]/g, '')}%`); }
  if (f.validacao) { w.push('e.status_validacao = ?'); p.push(f.validacao); }
  if (f.prf) { w.push('e.status_prf = ?'); p.push(f.prf); }
  if (f.tipo_veiculo) { const l = lista(f.tipo_veiculo); w.push(`e.tipo_veiculo IN (${l.map(() => '?').join(',')})`); p.push(...l); }
  if (f.marca) { w.push('e.marca = ?'); p.push(f.marca); }
  if (f.cor) { w.push('e.cor_veiculo = ?'); p.push(f.cor); }
  if (f.faixa) { w.push('e.faixa = ?'); p.push(Number(f.faixa)); }
  if (f.sentido) { w.push('e.sentido = ?'); p.push(f.sentido); }
  if (f.vel_min) { w.push('e.velocidade >= ?'); p.push(Number(f.vel_min)); }
  if (f.vel_max) { w.push('e.velocidade <= ?'); p.push(Number(f.vel_max)); }
  if (f.placa_corrigida === '1') w.push('e.placa_ocr IS NOT NULL');
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const size = Math.min(Number(f.size) || 20, 200);
  const page = Math.max(Number(f.page) || 1, 1);
  const total = (await one(`SELECT COUNT(*) n FROM eventos e ${where}`, p)).n;
  const rows = await q(`${EVENT_SELECT} ${where} ORDER BY e.ocorrido_em DESC, e.id DESC LIMIT ? OFFSET ?`, [...p, size, (page - 1) * size]);
  const resumo = await q(`SELECT e.chave, COUNT(*) n, SUM(e.status_validacao='aguardando') aguardando FROM eventos e ${where} GROUP BY e.chave`, p);
  res.json({ total, page, size, items: await attachImages(rows), resumo });
});

/** Valores existentes para os filtros (tipo de veículo, marca, cor, faixa, sentido). */
eventosRouter.get('/opcoes', async (req, res) => {
  const col = async (c) => (await q(`SELECT ${c} v, COUNT(*) n FROM eventos WHERE ${c} IS NOT NULL AND ${c} <> '' GROUP BY ${c} ORDER BY n DESC LIMIT 60`)).map((r) => ({ v: r.v, n: Number(r.n) }));
  res.json({ tipo_veiculo: await col('tipo_veiculo'), marca: await col('marca'), cor: await col('cor_veiculo'), faixa: await col('faixa'), sentido: await col('sentido') });
});

/** Log de alterações de todos os registros (aba "Log de alterações"). */
eventosRouter.get('/log', async (req, res) => {
  const w = [];
  const p = [];
  if (req.query.tipo === 'manual' || !req.query.tipo) w.push("l.usuario_txt <> 'sistema'");
  else if (req.query.tipo !== 'todas') { w.push('l.acao = ?'); p.push(req.query.tipo); }
  if (req.query.usuario) { w.push('l.usuario_txt = ?'); p.push(req.query.usuario); }
  const rows = await q(`SELECT l.*, e.chave, e.placa, a.nome analitico_nome, a.grupo analitico_grupo FROM evento_log l
    JOIN eventos e ON e.id=l.evento_id LEFT JOIN analiticos a ON a.chave=e.chave
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY l.criado_em DESC LIMIT 300`, p);
  res.json(rows);
});

eventosRouter.get('/:id', async (req, res) => {
  const e = await getEvento(req.params.id, { withLog: true });
  if (!e) return res.status(404).json({ erro: 'Registro não encontrado' });
  res.json(e);
});

eventosRouter.post('/:id/validar', async (req, res) => {
  const e = await one('SELECT id, status_validacao, status_prf FROM eventos WHERE id=?', [req.params.id]);
  if (!e) return res.status(404).json({ erro: 'Registro não encontrado' });
  if (e.status_validacao === 'validado') return res.status(409).json({ erro: 'Registro já validado.' });
  await q("UPDATE eventos SET status_validacao='validado', validado_por=?, validado_em=NOW() WHERE id=?", [req.user.id, e.id]);
  await q('INSERT INTO evento_log (evento_id, usuario_id, usuario_txt, acao, detalhe) VALUES (?,?,?,?,?)',
    [e.id, req.user.id, req.user.usuario, 'Validado', 'Assinatura registrada']);
  if (e.status_prf === 'aguardando') {
    await q("UPDATE eventos SET status_prf='fila' WHERE id=?", [e.id]);
    await q("INSERT INTO evento_log (evento_id, usuario_txt, acao) VALUES (?, 'sistema', 'Entrou na fila de envio à PRF')", [e.id]);
  }
  const full = await getEvento(e.id, { withLog: true });
  broadcast('evento_atualizado', { evento: full });
  res.json(full);
});

eventosRouter.post('/:id/placa', async (req, res) => {
  const placa = String(req.body?.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const motivo = String(req.body?.motivo || 'Leitura OCR incorreta').slice(0, 120);
  if (!PLACA_RX.test(placa)) return res.status(400).json({ erro: 'Formato inválido. Use ABC1D23 ou ABC1234.' });
  const e = await one('SELECT id, placa, placa_ocr, status_prf FROM eventos WHERE id=?', [req.params.id]);
  if (!e) return res.status(404).json({ erro: 'Registro não encontrado' });
  if (e.placa === placa) return res.json(await getEvento(e.id, { withLog: true }));
  await q('UPDATE eventos SET placa=?, placa_ocr=COALESCE(placa_ocr, ?, ?) WHERE id=?', [placa, e.placa, 'NAO_LIDA', e.id]);
  await q('INSERT INTO evento_log (evento_id, usuario_id, usuario_txt, acao, detalhe, motivo) VALUES (?,?,?,?,?,?)',
    [e.id, req.user.id, req.user.usuario, 'Placa corrigida', `${e.placa || 'não lida'} → ${placa}`, motivo]);
  if (e.status_prf === 'enviado') {
    await q("UPDATE eventos SET status_prf='fila' WHERE id=?", [e.id]);
    await q("INSERT INTO evento_log (evento_id, usuario_txt, acao, detalhe) VALUES (?, 'sistema', 'Reenvio à PRF agendado', 'Registro alterado após o envio')", [e.id]);
  }
  const full = await getEvento(e.id, { withLog: true });
  broadcast('evento_atualizado', { evento: full });
  res.json(full);
});
