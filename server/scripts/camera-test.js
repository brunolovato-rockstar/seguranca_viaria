// Teste rápido da câmera pelo terminal, sem banco e sem front.
// Uso:  npm run camera:test -- http://localhost:63519 admin SENHA [segundos]
// Mostra as informações do equipamento, salva um snapshot e escuta os eventos por alguns segundos.
import fs from 'node:fs';
import { getInfo, snapshot, openEventStream } from '../src/dahua/client.js';

const [url = 'http://localhost:63519', usuario = 'admin', senha = '', seg = '60'] = process.argv.slice(2);
const cam = { url_base: url, usuario, senha, canal: 1 };

console.log(`\nCâmera: ${url}  (usuário ${usuario})\n`);
try {
  const t0 = Date.now();
  const info = await getInfo(cam);
  console.log('✔ Conectou em', Date.now() - t0, 'ms');
  console.table(info);
} catch (e) {
  console.error('✖ Falha ao ler informações:', e.message);
  process.exit(1);
}

try {
  const buf = await snapshot(cam);
  fs.writeFileSync('snapshot-teste.jpg', buf);
  console.log(`✔ Snapshot salvo em snapshot-teste.jpg (${(buf.length / 1024).toFixed(0)} KB)`);
} catch (e) {
  console.error('✖ Snapshot falhou:', e.message);
}

for (const mode of ['attachFileProc', 'eventManager']) {
  console.log(`\n… escutando eventos (${mode}) por ${seg}s. Provoque uma detecção na câmera.`);
  const n = await new Promise((resolve) => {
    let count = 0;
    const em = openEventStream(cam, { mode });
    em.on('open', () => console.log('  conectado ao fluxo de eventos'));
    em.on('heartbeat', () => process.stdout.write('♥ '));
    em.on('event', (ev) => {
      count++;
      console.log(`\n  ● ${ev.code} (${ev.action}) · ${ev.images.length} imagem(ns)`);
      console.log('   ', ev.rawText.split(/\r?\n/).slice(0, 12).join('\n    '));
    });
    em.on('close', (e) => { if (e) console.log('\n  fluxo encerrado:', e.message); resolve(count); });
    setTimeout(() => { em.stop(); resolve(count); }, Number(seg) * 1000);
  });
  console.log(`\n  ${n} evento(s) recebidos em ${mode}`);
  if (n > 0) break;
}
process.exit(0);
