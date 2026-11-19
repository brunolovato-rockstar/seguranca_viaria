// Converte o que a câmera manda (HTTP API ou ITSAPI push) para o formato do nosso registro.

const pickBySuffix = (flat, suffixes) => {
  for (const s of suffixes) {
    const k = Object.keys(flat).find((x) => x === s || x.endsWith('.' + s));
    if (k && flat[k] !== '') return flat[k];
  }
  return null;
};

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

const cleanPlate = (p) => {
  if (!p) return null;
  const s = String(p).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s && !/^(UNKNOWN|NULL|0+)$/.test(s) ? s.slice(0, 12) : null;
};

function parseCamTime(v) {
  if (!v) return null;
  if (/^\d{9,10}$/.test(String(v))) return new Date(Number(v) * 1000);
  const d = new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

const COR = { white: 'Branco', black: 'Preto', gray: 'Cinza', grey: 'Cinza', silver: 'Prata', red: 'Vermelho', blue: 'Azul', green: 'Verde',
  yellow: 'Amarelo', brown: 'Marrom', orange: 'Laranja', purple: 'Roxo', pink: 'Rosa', golden: 'Dourado', gold: 'Dourado', other: 'Outra', unknown: null };
const TIPO = { salooncar: 'Passeio', saloncar: 'Passeio', saloon: 'Passeio', microcar: 'Passeio', minicar: 'Passeio', oilcar: 'Caminhão-tanque',
  tankcar: 'Caminhão-tanque', largecar: 'Caminhão', midcar: 'Utilitário', mediumbus: 'Micro-ônibus', smallbus: 'Micro-ônibus', lighttruck: 'Caminhão leve',
  mediumtruck: 'Caminhão', heavytruck: 'Caminhão', dumptruck: 'Caminhão', trailer: 'Carreta', tractor: 'Trator', passengercar: 'Passeio', 'passenger car': 'Passeio', car: 'Passeio', sedan: 'Passeio', hatchback: 'Passeio', suv: 'SUV', mpv: 'Minivan',
  minivan: 'Minivan', van: 'Van', pickup: 'Caminhonete', 'pickup truck': 'Caminhonete', truck: 'Caminhão', largetruck: 'Caminhão', 'large truck': 'Caminhão',
  smalltruck: 'Caminhão leve', bus: 'Ônibus', largebus: 'Ônibus', minibus: 'Micro-ônibus', motorcycle: 'Motocicleta', motor: 'Motocicleta',
  nonmotor: 'Não motorizado', bicycle: 'Bicicleta', tricycle: 'Triciclo', unknown: null };
const tr = (map, v) => {
  if (v == null || v === '') return null;
  const k = String(v).trim().toLowerCase();
  return k in map ? map[k] : String(v);
};
/** Traduz tipo/cor gravados em inglês por versões antigas (usado no Dashboard). */
export const tipoPt = (v) => tr(TIPO, v);
export const corPt = (v) => tr(COR, v);
const posInt = (v) => { const n = toInt(v); return n && n > 0 ? n : null; };

/** Códigos de evento que aparecem DENTRO do texto (ex.: TrafficCar.Event=TrafficWithoutSafeBelt num TrafficJunction). */
function candidateCodes(flat, baseCode) {
  const out = [];
  for (const [k, v] of Object.entries(flat)) {
    if (/EventBaseInfo\.Code$/.test(k)) continue;
    const s = String(v);
    if (/^Traffic[A-Za-z]+$/.test(s) && s !== baseCode && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Evento vindo do fluxo HTTP API (snapManager attachFileProc ou eventManager). */
export function fromHttpApi(ev) {
  const f = { ...ev.flat };
  // eventManager traz um JSON em data: achata para usar a mesma busca
  const walk = (o, pre) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      const key = pre ? `${pre}.${k}` : k;
      if (v && typeof v === 'object') walk(v, key);
      else f[key] = v;
    }
  };
  if (ev.data && !Object.keys(ev.flat).length) walk(ev.data, '');

  const bbox = ['0', '1', '2', '3'].map((i) => toInt(pickBySuffix(f, [`Object.BoundingBox[${i}]`, `BoundingBox[${i}]`])));
  const plate = cleanPlate(pickBySuffix(f, ['TrafficCar.PlateNumber', 'PlateNumber', 'Object.Text']));
  return {
    codigo: ev.code,
    ocorrido_em: parseCamTime(pickBySuffix(f, ['EventBaseInfo.UTC', 'UTC', 'TrafficCar.SnapTime', 'Time'])) || new Date(),
    placa: plate,
    placa_confianca: toInt(pickBySuffix(f, ['TrafficCar.PlateConfidence', 'Object.Confidence', 'Confidence'])),
    placa_cor: pickBySuffix(f, ['TrafficCar.PlateColor', 'PlateColor']),
    tipo_veiculo: tr(TIPO, pickBySuffix(f, ['TrafficCar.VehicleType', 'Vehicle.Category', 'VehicleType', 'Category'])),
    marca: pickBySuffix(f, ['TrafficCar.VehicleSign', 'Vehicle.Text', 'VehicleSign']),
    cor_veiculo: tr(COR, pickBySuffix(f, ['TrafficCar.VehicleColor', 'Vehicle.MainColor', 'VehicleColor'])),
    velocidade: posInt(pickBySuffix(f, ['TrafficCar.Speed', 'Speed'])), // 0 = câmera sem medição
    faixa: toInt(pickBySuffix(f, ['TrafficCar.Lane', 'Lane', 'LaneNumber'])),
    sentido: (() => { const d = pickBySuffix(f, ['TrafficCar.Direction', 'Direction']); return d == null || /^\d+$/.test(String(d)) ? null : d; })(),
    bbox: bbox.every((x) => x != null) ? bbox : null,
    candidatos: candidateCodes(f, ev.code),
  };
}

/** Coleta todas as imagens base64 de um objeto "Picture" do ITSAPI. */
function collectPictures(pic) {
  const out = [];
  const map = { NormalPic: 'evento', CutoutPic: 'placa', VehiclePic: 'veiculo', CombinPic: 'composta', FacePic: 'rosto' };
  const visit = (node, tipo) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach((n) => visit(n, tipo)); return; }
    if (typeof node === 'object') {
      if (typeof node.Content === 'string' && node.Content.length > 100) {
        out.push({ tipo, buf: Buffer.from(node.Content, 'base64') });
        return;
      }
      for (const [k, v] of Object.entries(node)) visit(v, map[k.trim()] || tipo);
    }
  };
  visit(pic, 'outro');
  return out;
}

/** Push do ITSAPI: /NotificationInfo/TollgateInfo e /NotificationInfo/TrafficViolationInfo */
export function fromItsapi(kind, body) {
  const plate = body.Plate || {};
  const veh = body.Vehicle || {};
  const snap = body.SnapInfo || {};
  const tv = body.TrafficViolationInfo || {};
  const codigo = kind === 'TrafficViolationInfo' ? (tv.ViolationType || body.ViolationType || 'TrafficViolation') : 'Tollgate';
  return {
    codigo,
    deviceId: snap.DeviceID || body.DeviceID || tv.DeviceID || null,
    ocorrido_em: parseCamTime(snap.AccurateTime || snap.SnapTime || tv.AccurateTime || body.AccurateTime) || new Date(),
    placa: plate.IsExist === false ? null : cleanPlate(plate.PlateNumber),
    placa_confianca: plate.Confidence != null ? Math.round((Number(plate.Confidence) / 255) * 100) : null,
    placa_cor: plate.PlateColor || null,
    tipo_veiculo: veh.VehicleType || null,
    marca: veh.VehicleSign || null,
    cor_veiculo: veh.VehicleColor || null,
    velocidade: toInt(veh.Speed),
    faixa: toInt(snap.LanNo ?? veh.LanNo),
    sentido: snap.Direction || null,
    bbox: Array.isArray(veh.VehicleBoundingBox) ? veh.VehicleBoundingBox : null,
    imagens: collectPictures(body.Picture),
  };
}
