// Exporta o que a câmera mandou (eventos brutos) para um arquivo texto, para análise do mapeamento.
// Uso: npm run diag            -> gera server/diagnostico-camera.txt
//      npm run diag -- 50      -> últimas 50 mensagens
import 'dotenv/config';
import fs from 'node:fs';
import { pool, q } from '../src/db.js';

const n = Number(process.argv[2]) || 25;
const out = [];
out.push(`Diagnóstico da câmera · gerado em ${new Date().toLocaleString('pt-BR')}\n`);

const codigos = await q(`SELECT codigo, COUNT(*) n, SUM(evento_id IS NULL) sem_mapa, SUM(imagens) imagens, MAX(recebido_em) ultimo
  FROM eventos_brutos GROUP BY codigo ORDER BY n DESC`);
out.push('=== Códigos recebidos ===');
for (const c of codigos) out.push(`${c.codigo.padEnd(40)} ${String(c.n).padStart(6)} msgs · ${c.sem_mapa} sem mapeamento · ${c.imagens} imagens · último ${new Date(c.ultimo).toLocaleString('pt-BR')}`);

const chaves = await q('SELECT codigo_origem, chave, COUNT(*) n FROM eventos GROUP BY codigo_origem, chave ORDER BY n DESC');
out.push('\n=== Registros gerados (código → analítico) ===');
for (const c of chaves) out.push(`${c.codigo_origem.padEnd(40)} → ${String(c.chave).padEnd(16)} ${c.n}`);

// Todas as chaves (sem os valores repetidos) que já apareceram — mostra onde a câmera põe cada informação
const amostra = await q('SELECT payload FROM eventos_brutos WHERE payload IS NOT NULL ORDER BY id DESC LIMIT 300');
const keys = new Map();
for (const r of amostra) {
  for (const line of String(r.payload).split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const k = line.slice(0, i).replace(/\[\d+\]/g, '[n]');
    const v = line.slice(i + 1).trim();
    if (!keys.has(k)) keys.set(k, new Set());
    if (keys.get(k).size < 6) keys.get(k).add(v.slice(0, 60));
  }
}
out.push(`\n=== Campos que a câmera envia (${keys.size}) · até 6 valores de exemplo ===`);
for (const [k, vs] of [...keys.entries()].sort()) out.push(`${k} = ${[...vs].join(' | ')}`);

const brutos = await q('SELECT id, codigo, recebido_em, imagens, payload FROM eventos_brutos ORDER BY id DESC LIMIT ?', [n]);
out.push(`\n=== Últimas ${brutos.length} mensagens completas ===`);
for (const b of brutos) {
  out.push(`\n----- #${b.id} · ${b.codigo} · ${new Date(b.recebido_em).toLocaleString('pt-BR')} · ${b.imagens} imagem(ns) -----`);
  out.push(String(b.payload || ''));
}

fs.writeFileSync('diagnostico-camera.txt', out.join('\n'), 'utf8');
console.log(`Gerado: diagnostico-camera.txt (${codigos.length} códigos, ${keys.size} campos, ${brutos.length} mensagens)`);
await pool.end();
