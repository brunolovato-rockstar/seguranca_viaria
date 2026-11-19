// Guarda o log do servidor em memória (para a tela Diagnóstico → Sistema) e em arquivo diário
// (storage/logs/servidor-AAAA-MM-DD.log). Importado primeiro no index.js para pegar tudo.
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { config } from '../config.js';

const MAX = 3000;
const buf = [];
let seq = 0;
const dir = path.join(config.storageDir, 'logs');
try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }

const dia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hora = (d) => d.toTimeString().slice(0, 8);

function guardar(nivel, args) {
  const d = new Date();
  const msg = util.format(...args).replace(/\u001b\[[0-9;]*m/g, '').trim();
  if (!msg) return;
  const item = { id: ++seq, ts: d.getTime(), nivel, msg };
  buf.push(item);
  if (buf.length > MAX) buf.shift();
  try { fs.appendFileSync(path.join(dir, `servidor-${dia(d)}.log`), `${dia(d)} ${hora(d)} ${nivel.toUpperCase().padEnd(5)} ${msg}\n`); } catch { /* disco cheio etc.: segue */ }
}

for (const [fn, nivel] of [['log', 'info'], ['info', 'info'], ['warn', 'aviso'], ['error', 'erro']]) {
  const orig = console[fn].bind(console);
  console[fn] = (...args) => { orig(...args); guardar(nivel, args); };
}

export function lerLogs({ desde = 0, limite = 500, nivel = '' } = {}) {
  let l = buf.filter((x) => x.id > desde);
  if (nivel === 'aviso') l = l.filter((x) => x.nivel !== 'info');
  else if (nivel === 'erro') l = l.filter((x) => x.nivel === 'erro');
  return { itens: l.slice(-limite), ultimo: seq };
}
export const pastaLogs = dir;
export const arquivoHoje = () => path.join(dir, `servidor-${dia(new Date())}.log`);
