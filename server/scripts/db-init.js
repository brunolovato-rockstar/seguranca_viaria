// Cria o banco, as tabelas, o catálogo de analíticos, o usuário admin e a CAM-01 (túnel).
// Uso: npm run db:init     (pode rodar de novo: não apaga dados)
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { encrypt } from '../src/crypto.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(dir, '../../db');
const name = process.env.DB_NAME || 'seguranca_viaria';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
});

console.log(`→ Banco "${name}"`);
await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await conn.query(`USE \`${name}\``);

console.log('→ Tabelas (db/schema.sql)');
await conn.query(fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8'));
console.log('→ Analíticos e códigos (db/seed.sql)');
await conn.query(fs.readFileSync(path.join(dbDir, 'seed.sql'), 'utf8'));

const adminUser = (process.env.ADMIN_USER || 'admin').toLowerCase();
const [[admin]] = await conn.query('SELECT id FROM usuarios WHERE usuario=?', [adminUser]);
if (!admin) {
  await conn.query('INSERT INTO usuarios (usuario, nome, perfil, senha_hash) VALUES (?,?,?,?)',
    [adminUser, 'Administrador', 'admin', await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10)]);
  console.log(`→ Usuário criado: ${adminUser} / ${process.env.ADMIN_PASSWORD || 'admin123'}`);
} else {
  console.log(`→ Usuário ${adminUser} já existe`);
}

if (process.env.CAM1_URL) {
  const [[cam]] = await conn.query("SELECT id FROM cameras WHERE codigo='CAM-01'");
  if (!cam) {
    await conn.query(
      "INSERT INTO cameras (codigo, nome, finalidade, url_base, usuario, senha_enc, acesso, modo_eventos, canal, rodovia, rtsp_url) VALUES ('CAM-01',?, 'custom', ?, ?, ?, 'http_api', 'attachFileProc', 1, 'BR-376', ?)",
      [process.env.CAM1_NOME || 'Câmera da rua (túnel)', process.env.CAM1_URL, process.env.CAM1_USER || 'admin', encrypt(process.env.CAM1_PASSWORD || ''), process.env.CAM1_RTSP_URL || null],
    );
    console.log(`→ Câmera CAM-01 cadastrada em ${process.env.CAM1_URL}`);
  } else {
    // CAM-01 já existe: completa só o que estiver vazio (não sobrescreve o que foi editado na tela)
    const [[c1]] = await conn.query("SELECT id, senha_enc, rtsp_url FROM cameras WHERE codigo='CAM-01'");
    if (!c1.senha_enc && process.env.CAM1_PASSWORD) {
      await conn.query('UPDATE cameras SET usuario=?, senha_enc=? WHERE id=?', [process.env.CAM1_USER || 'admin', encrypt(process.env.CAM1_PASSWORD), c1.id]);
      console.log('→ CAM-01: senha da câmera gravada a partir do .env');
    }
    if (!c1.rtsp_url && process.env.CAM1_RTSP_URL) {
      await conn.query('UPDATE cameras SET rtsp_url=? WHERE id=?', [process.env.CAM1_RTSP_URL, c1.id]);
      console.log('→ CAM-01: URL RTSP gravada a partir do .env');
    }
    console.log('→ CAM-01 já existe (demais dados: edite pela tela Câmeras)');
  }
  // localização da CAM-01 (mapa): CAM1_LAT / CAM1_LNG no .env
  if (process.env.CAM1_LAT && process.env.CAM1_LNG) {
    const lat = Number(process.env.CAM1_LAT).toFixed(6), lng = Number(process.env.CAM1_LNG).toFixed(6);
    const [r] = await conn.query("UPDATE cameras SET latitude=?, longitude=? WHERE codigo='CAM-01' AND (latitude IS NULL OR longitude IS NULL OR latitude<>? OR longitude<>?)", [lat, lng, lat, lng]);
    if (r.affectedRows) console.log(`→ CAM-01: localização ${lat}, ${lng} gravada (mapa)`);
  }
}

await conn.end();
console.log('\nPronto. Agora: npm run dev');
