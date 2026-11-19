// Receptor do ITSAPI (Dahua ITS Integration Protocol V1.22): a câmera faz POST para o nosso servidor.
// Uso na fase 2, quando a câmera conseguir alcançar este servidor (IP público, VPN ou túnel reverso).
// Configurar na câmera: servidor = IP deste PC, porta = PORT do .env.
import express from 'express';
import { one } from '../db.js';
import { fromItsapi } from './normalize.js';
import { ingest } from '../services/ingest.js';
import { q } from '../db.js';

export const itsapiRouter = express.Router();
itsapiRouter.use(express.json({ limit: '60mb' }));

const ok = (res, extra = {}) => res.json({ Result: true, Message: 'Success', RspTime: new Date().toISOString().replace('T', ' ').slice(0, 19), ...extra });

async function findCamera(deviceId, ip) {
  if (deviceId) {
    const c = await one('SELECT * FROM cameras WHERE device_id=?', [deviceId]);
    if (c) return c;
  }
  const clean = String(ip || '').replace('::ffff:', '');
  return one('SELECT * FROM cameras WHERE url_base LIKE ? LIMIT 1', [`%${clean}%`]);
}

itsapiRouter.post('/DeviceInfo', async (req, res) => {
  const b = req.body || {};
  const cam = await findCamera(b.DeviceID, req.ip);
  if (cam && b.DeviceID && !cam.device_id) await q('UPDATE cameras SET device_id=?, modelo=COALESCE(modelo, ?) WHERE id=?', [b.DeviceID, b.DeviceModel || null, cam.id]);
  await q("INSERT INTO eventos_brutos (camera_id, origem, codigo, payload) VALUES (?, 'itsapi', 'DeviceInfo', ?)", [cam?.id || null, JSON.stringify(b).slice(0, 60000)]);
  ok(res);
});

itsapiRouter.post('/KeepAlive', (req, res) => ok(res));

async function handleEvent(kind, req, res) {
  const body = req.body || {};
  const ev = fromItsapi(kind, body);
  const cam = await findCamera(ev.deviceId, req.ip);
  const resumo = JSON.stringify(body, (k, v) => (k === 'Content' && typeof v === 'string' ? `<base64 ${v.length} chars>` : v));
  await ingest({ camera: cam, origem: 'itsapi', ev, imagens: ev.imagens, raw: resumo });
  ok(res, ev.placa ? { PlateNumber: ev.placa, DeviceID: ev.deviceId || undefined } : {});
}

itsapiRouter.post('/TollgateInfo', (req, res) => handleEvent('TollgateInfo', req, res).catch((e) => res.status(500).json({ Result: false, Message: e.message })));
itsapiRouter.post('/TrafficViolationInfo', (req, res) => handleEvent('TrafficViolationInfo', req, res).catch((e) => res.status(500).json({ Result: false, Message: e.message })));

// Demais pushes (estacionamento, alarmes, fluxo): guarda bruto para análise
itsapiRouter.post('/:kind', async (req, res) => {
  await q("INSERT INTO eventos_brutos (origem, codigo, payload) VALUES ('itsapi', ?, ?)", [req.params.kind, JSON.stringify(req.body || {}).slice(0, 60000)]);
  ok(res);
});
