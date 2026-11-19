// Diagnóstico de login da câmera (sem expor a senha).
// Uso:  npm run camera:check            -> confere a senha salva no banco e faz 1 tentativa de login
//       npm run camera:check -- --fix   -> grava no banco a senha do .env (CAM1_PASSWORD) e testa com ela
import 'dotenv/config';
import http from 'node:http';
import { q } from '../src/db.js';
import { decrypt, encrypt } from '../src/crypto.js';
import { camRequest } from '../src/dahua/http.js';

const fix = process.argv.includes('--fix');
const [cam] = await q("SELECT id, codigo, url_base, usuario, senha_enc FROM cameras WHERE codigo='CAM-01'");
if (!cam) { console.log('CAM-01 não existe no banco. Rode npm run db:init.'); process.exit(1); }
const senhaDb = decrypt(cam.senha_enc);
const senhaEnv = process.env.CAM1_PASSWORD || '';
console.log(`\nCAM-01 · ${cam.url_base} · usuário "${cam.usuario}"`);
console.log(`Senha no banco: ${senhaDb ? `${senhaDb.length} caracteres` : 'VAZIA (ou não deu para ler — CRYPTO_KEY mudou?)'}` +
  `${senhaDb && senhaDb !== senhaDb.trim() ? ' · ATENÇÃO: tem espaço no começo/fim' : ''}`);
if (senhaEnv) console.log(`Senha do .env (CAM1_PASSWORD): ${senhaEnv.length} caracteres · ${senhaDb === senhaEnv ? 'IGUAL à do banco' : 'DIFERENTE da do banco'}`);

// desafio que a câmera manda (sem tentar login)
await new Promise((ok) => {
  const u = new URL('/cgi-bin/magicBox.cgi?action=getDeviceType', cam.url_base);
  http.get(u, (r) => {
    console.log(`\nSem login a câmera responde ${r.statusCode}. Desafios:`);
    for (const h of r.headersDistinct?.['www-authenticate'] || []) console.log('  ', h.replace(/nonce="[^"]+"/, 'nonce="…"'));
    r.resume(); ok();
  }).on('error', (e) => { console.log('Sem resposta da câmera:', e.message); ok(); });
});

let senha = senhaDb;
if (fix) {
  if (!senhaEnv) { console.log('\n--fix: CAM1_PASSWORD está vazio no .env.'); process.exit(1); }
  await q('UPDATE cameras SET usuario=?, senha_enc=? WHERE id=?', [process.env.CAM1_USER || cam.usuario, encrypt(senhaEnv), cam.id]);
  console.log('\n--fix: senha do .env gravada no banco.');
  senha = senhaEnv;
}

console.log('\nTentando 1 login…');
try {
  const r = await camRequest({ url_base: cam.url_base, usuario: process.env.CAM1_USER && fix ? process.env.CAM1_USER : cam.usuario, senha }, '/cgi-bin/magicBox.cgi?action=getDeviceType');
  console.log('✔ Login OK:', r.body.toString().trim());
  if (fix) console.log('Agora reinicie o servidor (ou salve a câmera na tela) para ele usar a senha nova.');
} catch (e) {
  console.log('✖', e.message);
  if (!fix && senhaEnv && senhaDb !== senhaEnv) console.log('\nA senha do banco é diferente da do .env. Se a do .env estiver certa: npm run camera:check -- --fix');
}
process.exit(0);
