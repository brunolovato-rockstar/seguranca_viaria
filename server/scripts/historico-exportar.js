// Exporta as INFRAÇÕES (sem ANPR) com fotos e histórico, para levar a outro servidor.
// Uso (na pasta server):  npm run historico:exportar -- [--de 2026-11-18] [--ate 2026-11-26] [--saida ../exportacao-historico]
// Depois: compacte a pasta de saída e copie para o servidor (veja o fim da execução).
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const de = arg('de'), ate = arg('ate');
const saida = path.resolve(arg('saida', '../exportacao-historico'));

// datas como texto, exatamente como estão no banco (não depende do fuso de quem exporta/importa)
const db = await mysql.createConnection({ ...config.db, dateStrings: true });
const w = ['a.infracao = 1'], p = [];
if (de) { w.push('e.ocorrido_em >= ?'); p.push(`${de} 00:00:00`); }
if (ate) { w.push('e.ocorrido_em <= ?'); p.push(`${ate} 23:59:59.999`); }
const [eventos] = await db.query(
  `SELECT e.*, c.codigo AS camera_codigo, u.usuario AS validado_por_usuario
     FROM eventos e JOIN analiticos a ON a.chave = e.chave
     LEFT JOIN cameras c ON c.id = e.camera_id LEFT JOIN usuarios u ON u.id = e.validado_por
    WHERE ${w.join(' AND ')} ORDER BY e.id`, p);
if (!eventos.length) { console.log('Nenhuma infração no período.'); process.exit(0); }
const ids = eventos.map((e) => e.id);
const [imgs] = await db.query(`SELECT * FROM evento_imagens WHERE evento_id IN (?) ORDER BY id`, [ids]);
const [logs] = await db.query(`SELECT * FROM evento_log WHERE evento_id IN (?) ORDER BY id`, [ids]);
await db.end();

fs.mkdirSync(path.join(saida, 'fotos'), { recursive: true });
let bytes = 0, faltando = 0;
for (const i of imgs) {
  const src = path.join(config.storageDir, i.caminho);
  const dst = path.join(saida, 'fotos', i.caminho);
  if (!fs.existsSync(src)) { faltando++; continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  bytes += fs.statSync(dst).size;
}
const registros = eventos.map((e) => ({
  ...e,
  imagens: imgs.filter((i) => i.evento_id === e.id),
  log: logs.filter((l) => l.evento_id === e.id),
}));
fs.writeFileSync(path.join(saida, 'dados.json'), JSON.stringify({ versao: 1, origem: os.hostname(), exportado_em: new Date().toISOString(), filtro: { de, ate }, registros }));

const porAn = {};
for (const e of eventos) porAn[e.chave] = (porAn[e.chave] || 0) + 1;
console.log(`\n${eventos.length} infrações · ${imgs.length - faltando} fotos (${(bytes / 1e6).toFixed(0)} MB)${faltando ? ` · ${faltando} fotos não encontradas` : ''}`);
console.table(porAn);
console.log(`Pasta: ${saida}\n`);
console.log('Para levar ao servidor (PowerShell, na pasta acima dela):');
console.log(`  tar -czf historico.tgz -C "${path.dirname(saida)}" "${path.basename(saida)}"`);
console.log('  scp historico.tgz pumatronix@IP-DO-SERVIDOR:/tmp/');
