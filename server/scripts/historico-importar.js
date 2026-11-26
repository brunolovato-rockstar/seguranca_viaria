// Importa o pacote gerado por historico:exportar. Pode rodar de novo: não duplica.
// Uso (no servidor):  cd /opt/seguranca-viaria/server && sudo -u svapp npm run historico:importar -- /tmp/exportacao-historico
// Os importados ganham números novos, guardam o número original e NUNCA vão para a PRF (status_prf = 'na').
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';

const pasta = path.resolve(process.argv[2] || '/tmp/exportacao-historico');
const arq = path.join(pasta, 'dados.json');
if (!fs.existsSync(arq)) { console.error(`Não achei ${arq}`); process.exit(1); }
const pacote = JSON.parse(fs.readFileSync(arq, 'utf8'));
const db = await mysql.createConnection({ ...config.db, dateStrings: true });
const one = async (sql, p) => (await db.query(sql, p))[0][0];

const cams = new Map((await db.query('SELECT id, codigo FROM cameras'))[0].map((c) => [c.codigo, c.id]));
const users = new Map((await db.query('SELECT id, usuario FROM usuarios'))[0].map((u) => [u.usuario, u.id]));
const ans = new Set((await db.query('SELECT chave FROM analiticos'))[0].map((a) => a.chave));
const json = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));
let novos = 0, pulados = 0, fotos = 0;

for (const r of pacote.registros) {
  const ja = await one(`SELECT id FROM eventos WHERE JSON_UNQUOTE(JSON_EXTRACT(dados, '$.importado.id')) = ? AND JSON_UNQUOTE(JSON_EXTRACT(dados, '$.importado.origem')) = ?`,
    [String(r.id), pacote.origem]);
  if (ja || !ans.has(r.chave)) { pulados++; continue; }
  let dados = r.dados;
  if (typeof dados === 'string') { try { dados = JSON.parse(dados); } catch { dados = { texto: dados }; } }
  dados = { ...(dados || {}), importado: { id: r.id, origem: pacote.origem, em: new Date().toISOString() } };

  await db.beginTransaction();
  try {
    const [ins] = await db.query(
      `INSERT INTO eventos (camera_id, chave, codigo_origem, origem, ocorrido_em, recebido_em, placa, placa_ocr, placa_confianca, placa_cor,
        tipo_veiculo, marca, modelo, cor_veiculo, velocidade, faixa, sentido, bbox, dados, status_validacao, validado_por, validado_em, status_prf)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'na')`,
      [cams.get(r.camera_codigo) || null, r.chave, r.codigo_origem, r.origem, r.ocorrido_em, r.recebido_em, r.placa, r.placa_ocr, r.placa_confianca,
        r.placa_cor, r.tipo_veiculo, r.marca, r.modelo, r.cor_veiculo, r.velocidade, r.faixa, r.sentido, json(r.bbox), json(dados),
        r.status_validacao, users.get(r.validado_por_usuario) || null, r.validado_em]);
    const id = ins.insertId;
    for (const i of r.imagens) {
      const src = path.join(pasta, 'fotos', i.caminho);
      if (!fs.existsSync(src)) continue;
      const rel = `importado/${i.caminho}`;
      const dst = path.join(config.storageDir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      await db.query('INSERT INTO evento_imagens (evento_id, tipo, caminho, bytes) VALUES (?,?,?,?)', [id, i.tipo, rel, i.bytes]);
      fotos++;
    }
    for (const l of r.log) {
      await db.query('INSERT INTO evento_log (evento_id, usuario_id, usuario_txt, acao, detalhe, motivo, criado_em) VALUES (?,?,?,?,?,?,?)',
        [id, users.get(l.usuario_txt) || null, l.usuario_txt, l.acao, l.detalhe, l.motivo, l.criado_em]);
    }
    await db.query('INSERT INTO evento_log (evento_id, usuario_txt, acao, detalhe) VALUES (?,?,?,?)',
      [id, 'sistema', 'Importado do ambiente de teste', `registro #${r.id} de ${pacote.origem} · não é enviado à PRF`]);
    await db.commit();
    novos++;
  } catch (e) {
    await db.rollback();
    console.error(`registro #${r.id}: ${e.message}`);
  }
}
await db.end();
console.log(`\nImportados: ${novos} registros e ${fotos} fotos · já existiam ou sem analítico: ${pulados}`);
