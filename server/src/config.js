import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  port: Number(process.env.PORT || 3001),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  cryptoKey: process.env.CRYPTO_KEY || 'dev-crypto-key-dev-crypto-key-123',
  storageDir: path.resolve(root, process.env.STORAGE_DIR || './storage'),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'seguranca_viaria',
  },
  cameraEvents: process.env.CAMERA_EVENTS || '[All]',
  snapshotMinIntervalMs: Number(process.env.SNAPSHOT_MIN_INTERVAL_MS || 300),
  go2rtcUrl: process.env.GO2RTC_URL || 'http://localhost:1984',
  mapboxToken: process.env.MAPBOX_TOKEN || '',
  mapboxStyle: process.env.MAPBOX_STYLE || '',
};
