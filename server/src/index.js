import './services/logbuf.js'; // primeiro: passa a guardar todo o log (tela Sistema + arquivo)
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { pool } from './db.js';
import { authRouter, requireAuth } from './auth.js';
import { camerasRouter } from './routes/cameras.js';
import { eventosRouter } from './routes/eventos.js';
import { miscRouter } from './routes/misc.js';
import { dashboardRouter } from './routes/dashboard.js';
import { sistemaRouter } from './routes/sistema.js';
import { itsapiRouter } from './dahua/itsapi.js';
import { attachWs } from './ws.js';
import { startAll } from './services/cameraManager.js';
import { loadCatalog } from './services/ingest.js';

fs.mkdirSync(config.storageDir, { recursive: true });

const app = express();
app.set('trust proxy', true);

// ITSAPI (push da câmera) — fica fora do /api e sem JWT, como define o protocolo
app.use('/NotificationInfo', itsapiRouter);

app.use(express.json({ limit: '2mb' }));
app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'ok' }); } catch (e) { res.status(500).json({ ok: false, db: e.message }); }
});
app.use('/api/auth', authRouter);
app.use('/api/cameras', requireAuth, camerasRouter);
app.use('/api/eventos', requireAuth, eventosRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/sistema', requireAuth, sistemaRouter);
app.use('/api', requireAuth, miscRouter);
app.use('/media', requireAuth, express.static(config.storageDir, { maxAge: '7d' }));

// Em produção o build do React é servido pelo próprio Node
const webDist = path.resolve(config.root, '../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|media|ws|NotificationInfo).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: err.message });
});

// erro esquecido numa rota assíncrona não pode derrubar o servidor (e a captura junto)
process.on('unhandledRejection', (e) => console.error('[erro não tratado]', e?.message || e));
// conexão com a câmera caindo (túnel) não pode derrubar o servidor inteiro
process.on('uncaughtException', (e) => console.error('[erro inesperado]', e?.code || '', e?.message || e));

const server = http.createServer(app);
attachWs(server);

server.listen(config.port, async () => {
  console.log(`\n  POC Segurança Viária · API em http://localhost:${config.port}`);
  try {
    await pool.query('SELECT 1');
    await loadCatalog(true);
    await startAll();
  } catch (e) {
    console.error('  Banco indisponível:', e.message, '\n  Rode "npm run db:init" e confira o .env');
  }
});
