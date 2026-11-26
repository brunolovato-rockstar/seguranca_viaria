// Recebe um evento já normalizado, grava bruto + registro + imagens + histórico e avisa o front.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { q, one } from '../db.js';
import { broadcast } from '../ws.js';

let codeMap = new Map();
let analiticos = new Map();
let loadedAt = 0;

export async function loadCatalog(force = false) {
  if (!force && Date.now() - loadedAt < 60000) return;
  const codes = await q('SELECT codigo, chave FROM analitico_codigos');
  codeMap = new Map(codes.map((r) => [r.codigo.toLowerCase(), r.chave]));
  const an = await q('SELECT * FROM analiticos');
  analiticos = new Map(an.map((a) => [a.chave, a]));
  loadedAt = Date.now();
}

const fmtDia = (d) => [String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')];

async function saveImages(eventoId, ocorrido, imagens) {
  const [y, m, d] = fmtDia(ocorrido);
  const rel = path.join(y, m, d);
  await fs.mkdir(path.join(config.storageDir, rel), { recursive: true });
  let n = 0;
  for (const img of imagens) {
    const nome = `${eventoId}_${n++}_${img.tipo}.jpg`;
    const relPath = path.join(rel, nome).split(path.sep).join('/');
    await fs.writeFile(path.join(config.storageDir, relPath), img.buf);
    await q('INSERT INTO evento_imagens (evento_id, tipo, caminho, bytes) VALUES (?,?,?,?)', [eventoId, img.tipo, relPath, img.buf.length]);
  }
}

/**
 * camera: linha da tabela cameras (ou null)
 * origem: 'http_api' | 'itsapi' | 'mock'
 * ev: { codigo, ocorrido_em, placa, ... }
 * imagens: [{ tipo, buf }]
 * raw: texto/JSON original (para Diagnóstico)
 */
export async function ingest({ camera, origem, ev, imagens = [], raw = '' }) {
  await loadCatalog();
  let chave = codeMap.get(String(ev.codigo).toLowerCase()) || null;
  // Câmeras de trânsito costumam mandar a infração dentro do evento de passagem (TrafficJunction):
  // se houver um código de infração no texto, ele define o analítico.
  if (!chave || chave === 'anpr') {
    const viol = (ev.candidatos || []).find((c) => { const k = codeMap.get(c.toLowerCase()); return k && k !== 'anpr'; });
    if (viol) {
      ev.dados = { ...(ev.dados || {}), codigo_base: ev.codigo };
      ev.codigo = viol;
      chave = codeMap.get(viol.toLowerCase());
    }
  }
  const an = chave ? analiticos.get(chave) : null;
  const semAnpr = chave === 'anpr' && !config.salvarAnpr; // SALVAR_ANPR=0 no .env (servidor com disco limitado)
  const desativado = (an && !an.ativo) || semAnpr;
  const bruto = await q('INSERT INTO eventos_brutos (camera_id, origem, codigo, imagens, payload, erro) VALUES (?,?,?,?,?,?)', [
    camera?.id || null, origem, String(ev.codigo).slice(0, 80), imagens.length, semAnpr ? null : String(raw).slice(0, 60000),
    !chave ? 'Código sem mapeamento em analitico_codigos' : semAnpr ? 'ANPR não gravado (SALVAR_ANPR=0)' : desativado ? 'Analítico desativado (não gravado)' : null,
  ]);
  broadcast('bruto', { camera_id: camera?.id || null, codigo: ev.codigo, chave, imagens: imagens.length, ts: Date.now() });
  if (!chave || desativado) return null; // só vira registro o que estiver mapeado e ativo

  const statusPrf = an?.infracao ? 'aguardando' : 'na';
  const r = await q(
    `INSERT INTO eventos (camera_id, chave, codigo_origem, origem, ocorrido_em, placa, placa_confianca, placa_cor, tipo_veiculo, marca, modelo,
      cor_veiculo, velocidade, faixa, sentido, bbox, dados, status_prf)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [camera?.id || null, chave, String(ev.codigo).slice(0, 80), origem, ev.ocorrido_em, ev.placa, ev.placa_confianca, ev.placa_cor,
      ev.tipo_veiculo, ev.marca, ev.modelo || null, ev.cor_veiculo, ev.velocidade, ev.faixa, ev.sentido,
      ev.bbox ? JSON.stringify(ev.bbox) : null, ev.dados ? JSON.stringify(ev.dados).slice(0, 60000) : null, statusPrf],
  );
  const id = r.insertId;
  await q('UPDATE eventos_brutos SET evento_id=? WHERE id=?', [id, bruto.insertId]);
  if (imagens.length) await saveImages(id, ev.ocorrido_em, imagens);
  await q('INSERT INTO evento_log (evento_id, usuario_txt, acao, detalhe) VALUES (?,?,?,?)', [
    id, 'sistema', 'Detecção recebida', `${camera?.codigo || 'sem câmera'} · ${an?.nome || chave}${ev.placa ? ' · OCR ' + ev.placa : ' · placa não lida'}`,
  ]);
  const full = await getEvento(id);
  broadcast('evento', { evento: full });
  return full;
}

export const EVENT_SELECT = `
  SELECT e.*, c.codigo AS camera_codigo, c.nome AS camera_nome, c.km AS camera_km, c.rodovia AS camera_rodovia,
         a.nome AS analitico_nome, a.grupo AS analitico_grupo, a.infracao AS analitico_infracao,
         u.usuario AS validado_por_usuario, u.nome AS validado_por_nome
    FROM eventos e
    LEFT JOIN cameras c ON c.id=e.camera_id
    LEFT JOIN analiticos a ON a.chave=e.chave
    LEFT JOIN usuarios u ON u.id=e.validado_por`;

export async function attachImages(rows) {
  if (!rows.length) return rows;
  const imgs = await q(`SELECT evento_id, tipo, caminho FROM evento_imagens WHERE evento_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`, rows.map((r) => r.id));
  const by = new Map();
  for (const i of imgs) {
    if (!by.has(i.evento_id)) by.set(i.evento_id, []);
    by.get(i.evento_id).push({ tipo: i.tipo, url: '/media/' + i.caminho });
  }
  for (const r of rows) r.imagens = by.get(r.id) || [];
  return rows;
}

export async function getEvento(id, { withLog = false } = {}) {
  const row = await one(`${EVENT_SELECT} WHERE e.id=?`, [id]);
  if (!row) return null;
  await attachImages([row]);
  if (withLog) row.log = await q('SELECT usuario_txt, acao, detalhe, motivo, criado_em FROM evento_log WHERE evento_id=? ORDER BY criado_em DESC, id DESC', [id]);
  return row;
}
