// Câmera simulada para desenvolver sem a câmera da rua.
// Responde os mesmos CGIs (com Digest) e gera eventos de trânsito com imagem.
// Uso: npm run mock                       -> câmera em http://127.0.0.1:8099 (admin / mock123)
//      npm run mock -- --push http://localhost:3001   -> também envia pushes ITSAPI para o servidor
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.MOCK_PORT || 8099);
const USER = 'admin';
const PASS = process.env.MOCK_PASSWORD || 'mock123';
const REALM = 'Login to MOCK-ITC';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mock-assets');
const frames = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).map((f) => fs.readFileSync(path.join(dir, f)));
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const nonces = new Set();

const CODES = ['TrafficJunction', 'TrafficWithoutSafeBelt', 'TrafficDriverCalling', 'TrafficNonMotorWithoutSafehat', 'TrafficOverSpeed',
  'TrafficDriverSmoking', 'TrafficRetrograde', 'TrafficParking', 'VideoMotion'];
const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const plate = () => `${rnd(L)}${rnd(L)}${rnd(L)}${Math.floor(Math.random() * 10)}${rnd(L)}${Math.floor(Math.random() * 10)}${Math.floor(Math.random() * 10)}`;

function checkAuth(req, res) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Digest ')) {
    const p = {};
    h.replace(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g, (_, k, q, u) => { p[k] = q ?? u; });
    const ha1 = md5(`${p.username}:${REALM}:${PASS}`);
    const ha2 = md5(`${req.method}:${p.uri}`);
    const expect = p.qop ? md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
    if (p.username === USER && nonces.has(p.nonce) && expect === p.response) return true;
  }
  const nonce = crypto.randomBytes(16).toString('hex');
  nonces.add(nonce);
  res.writeHead(401, { 'WWW-Authenticate': `Digest realm="${REALM}", qop="auth", nonce="${nonce}", opaque="${md5('x')}", stale=FALSE` });
  res.end('Unauthorized');
  return false;
}

function eventText(code, idx) {
  const now = Math.floor(Date.now() / 1000);
  const p = code === 'VideoMotion' ? '' : plate();
  // como nas câmeras de trânsito reais: às vezes a infração vem DENTRO do TrafficJunction
  const embedded = code !== 'TrafficJunction' && code !== 'VideoMotion' && Math.random() < 0.5;
  return [
    `Events[0].EventBaseInfo.Code=${embedded ? 'TrafficJunction' : code}`,
    `Events[0].TrafficCar.Event=${code}`,
    'Events[0].EventBaseInfo.Action=Pulse',
    `Events[0].EventBaseInfo.Index=0`,
    `Events[0].EventBaseInfo.UTC=${now}`,
    `Events[0].GroupID=${idx}`,
    `Events[0].TrafficCar.PlateNumber=${p}`,
    `Events[0].TrafficCar.PlateColor=White`,
    `Events[0].TrafficCar.VehicleColor=${rnd(['White', 'Black', 'Silver', 'Red'])}`,
    `Events[0].TrafficCar.VehicleSign=${rnd(['Volkswagen', 'Fiat', 'Chevrolet', 'Toyota', 'Honda'])}`,
    `Events[0].TrafficCar.Speed=${code === 'TrafficOverSpeed' ? 95 + Math.floor(Math.random() * 30) : 40 + Math.floor(Math.random() * 40)}`,
    `Events[0].TrafficCar.Lane=${1 + Math.floor(Math.random() * 3)}`,
    `Events[0].Object.BoundingBox[0]=${3000 + Math.floor(Math.random() * 2000)}`,
    `Events[0].Object.BoundingBox[1]=4000`,
    `Events[0].Object.BoundingBox[2]=${6500 + Math.floor(Math.random() * 1000)}`,
    `Events[0].Object.BoundingBox[3]=7600`,
    `Events[0].Vehicle.Category=${code === 'TrafficNonMotorWithoutSafehat' ? 'Motorcycle' : rnd(['Passenger Car', 'SUV', 'Truck'])}`,
  ].join('\r\n');
}

let evIdx = 0;
const server = http.createServer((req, res) => {
  if (!checkAuth(req, res)) return;
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action');
  const send = (t) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(t + '\r\n'); };

  if (url.pathname === '/cgi-bin/magicBox.cgi') {
    if (action === 'getSystemInfo') return send('deviceType=ITC-MOCK\r\nhardwareVersion=1.00\r\nserialNumber=MOCK0001\r\nupdateSerial=ITC-MOCK');
    if (action === 'getSoftwareVersion') return send('version=2.800.0000000.1.R,build:2026-01-01');
    if (action === 'getDeviceType') return send('type=ITC-MOCK');
  }
  if (url.pathname === '/cgi-bin/global.cgi' && action === 'getCurrentTime') {
    return send('result=' + new Date().toISOString().replace('T', ' ').slice(0, 19));
  }
  if (url.pathname === '/cgi-bin/snapshot.cgi') {
    const f = frames[Math.floor(Date.now() / 2000) % frames.length];
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': f.length });
    return res.end(f);
  }
  if (url.pathname === '/cgi-bin/mjpg/video.cgi') {
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=myboundary' });
    const t = setInterval(() => {
      const f = frames[Math.floor(Date.now() / 2000) % frames.length];
      res.write(`--myboundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.length}\r\n\r\n`);
      res.write(f);
      res.write('\r\n');
    }, 200);
    req.on('close', () => clearInterval(t));
    return;
  }
  if (url.pathname === '/cgi-bin/snapManager.cgi' && action === 'attachFileProc') {
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=myboundary', Connection: 'keep-alive' });
    const hb = setInterval(() => res.write('--myboundary\r\nContent-Type: text/plain\r\nContent-Length: 9\r\n\r\nHeartbeat\r\n'), 5000);
    let t;
    const loop = () => {
      t = setTimeout(() => {
        let txt = eventText(rnd(CODES), evIdx++);
        // às vezes a câmera manda a passagem e a infração juntas na mesma mensagem (Events[0] e Events[1])
        if (Math.random() < 0.3) txt = eventText('TrafficJunction', evIdx) + '\r\n' + eventText('TrafficWithoutSafeBelt', evIdx++).replace(/Events\[0\]/g, 'Events[1]');
        const img = rnd(frames);
        res.write(`--myboundary\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(txt)}\r\n\r\n${txt}\r\n`);
        // imagem chega aos poucos (simula túnel lento): metade agora, metade 3 s depois
        res.write(`--myboundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${img.length}\r\n\r\n`);
        const half = Math.floor(img.length / 2);
        res.write(img.subarray(0, half));
        setTimeout(() => { res.write(img.subarray(half)); res.write('\r\n'); loop(); }, 3000);
      }, 3000 + Math.random() * 5000);
    };
    loop();
    req.on('close', () => { clearInterval(hb); clearTimeout(t); });
    return;
  }
  if (url.pathname === '/cgi-bin/eventManager.cgi' && action === 'attach') {
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=myboundary' });
    const t = setInterval(() => {
      const code = rnd(CODES);
      const body = `Code=${code};action=Pulse;index=0;data={"PlateNumber":"${plate()}","Speed":60,"Lane":1}`;
      res.write(`--myboundary\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\n\r\n${body}\r\n`);
    }, 5000);
    req.on('close', () => clearInterval(t));
    return;
  }
  res.writeHead(404);
  res.end('Error\r\nBad Request!');
});

server.on('error', (e) => console.log(`Porta ${PORT} ocupada (${e.code}) — seguindo só com o push ITSAPI, se pedido.`));
server.listen(PORT, () => {
  console.log(`Câmera simulada em http://127.0.0.1:${PORT}  (usuário ${USER} / senha ${PASS})`);
});

// ---- opcional: push ITSAPI para o servidor ----
const pushIdx = process.argv.indexOf('--push');
if (pushIdx > 0) {
  const target = process.argv[pushIdx + 1] || 'http://localhost:3001';
  const post = async (p, body) => {
    try {
      const r = await fetch(target + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      console.log('push', p, r.status, await r.text());
    } catch (e) { console.log('push falhou', e.message); }
  };
  const deviceId = '1c11c9c4-8dbc-4391-0dd7-56764ba18dbc';
  post('/NotificationInfo/DeviceInfo', { DeviceName: 'ITC-MOCK', DeviceModel: 'ITC-MOCK', DeviceType: 'Tollgate', Manufacturer: 'Mock', DeviceID: deviceId });
  setInterval(() => {
    const pic = rnd(frames).toString('base64');
    const viol = Math.random() < 0.5;
    const body = {
      Picture: viol ? { CombinPic: { PicName: 'c.jpg', Content: pic } } : { NormalPic: { PicName: 'n.jpg', Content: pic }, CutoutPic: { PicName: 'p.jpg', Content: rnd(frames).toString('base64') } },
      Plate: { IsExist: true, PlateNumber: plate(), PlateColor: 'White', Confidence: 230 },
      Vehicle: { VehicleColor: 'White', VehicleSign: 'Fiat', VehicleType: 'PassengerCar', Speed: 70, LanNo: 2 },
      SnapInfo: { SnapTime: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().replace('T', ' ').slice(0, 19), LanNo: 2, Direction: 'Obverse', DeviceID: deviceId },
      ...(viol ? { TrafficViolationInfo: { ViolationType: rnd(['TrafficWithoutSafeBelt', 'TrafficDriverCalling']), DeviceID: deviceId } } : {}),
    };
    post(viol ? '/NotificationInfo/TrafficViolationInfo' : '/NotificationInfo/TollgateInfo', body);
  }, 7000);
}
