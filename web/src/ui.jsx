// Peças visuais compartilhadas: ícones, placa, etiqueta de analítico, datas.
const P = {
  live: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" /></>,
  capture: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-8 8" /></>,
  records: <><path d="M5 3h10l4 4v14H5z" /><path d="M9 11h6M9 15h6M9 7h3" /></>,
  camera: <><rect x="2" y="7" width="14" height="10" rx="2" /><path d="M16 11l6-3v8l-6-3" /></>,
  ai: <><rect x="5" y="5" width="14" height="14" rx="3" /><path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.6 3.5 5.2" /></>,
  log: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  check: <path d="M5 12l5 5L20 7" />,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v4h4" /><path d="M12 7v5l3 2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  lock: <><rect x="4.5" y="10" width="15" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  bell: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  out: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" />,
  chevL: <path d="M15 5l-7 7 7 7" />,
  chevR: <path d="M9 5l7 7-7 7" />,
  down: <path d="M6 9l6 6 6-6" />,
  plug: <><path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></>,
  // analíticos
  seatbelt: <><circle cx="12" cy="5" r="2.5" /><path d="M6 21v-7a6 6 0 0 1 12 0v7" /><path d="M8 10l9 11" /></>,
  passenger: <><circle cx="9" cy="5" r="2.2" /><circle cx="16" cy="6" r="2" /><path d="M4 21v-6a5 5 0 0 1 10 0v6M13 21v-5a4 4 0 0 1 7-2.6" /><path d="M14 11l6 9" /></>,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></>,
  helmet: <><path d="M3 15a9 9 0 0 1 18 0v2H3z" /><path d="M12 6v5h9" /><path d="M3 17l2 3h5" /></>,
  overload: <><circle cx="7" cy="6" r="2" /><circle cx="12" cy="5" r="2" /><circle cx="17" cy="6" r="2" /><path d="M4 13a3 3 0 0 1 6 0M9 12a3 3 0 0 1 6 0M14 13a3 3 0 0 1 6 0" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="19" r="2" /><path d="M8 19h8" /></>,
  smoke: <><path d="M3 16h14v3H3zM19 16v3M21 16v3" /><path d="M19 13c0-2 2-2 2-4s-2-2-2-4" /></>,
  speed: <><path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l5-6" /></>,
  slow: <><path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l-4-5" /></>,
  wrongway: <path d="M4 8h12l-3-3M20 16H8l3 3" />,
  lane: <><path d="M5 3v18M19 3v18M12 3v3M12 9v3M12 15v3" /><path d="M8 17l7-7m0 0h-4m4 0v4" /></>,
  parking: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 17V7h4a3 3 0 0 1 0 6H9" /></>,
  bike: <><circle cx="6" cy="16" r="3.5" /><circle cx="18" cy="16" r="3.5" /><path d="M6 16l4-7h5l3 7M10 9l-1-3H7" /></>,
  jam: <><rect x="2" y="9" width="8" height="6" rx="1.5" /><rect x="14" y="9" width="8" height="6" rx="1.5" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  map: <><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></>,
  zoom: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5" /></>,
  plate: <><rect x="2" y="7" width="20" height="10" rx="2" /><path d="M6 12h3M11 12h2M15 12h3" /></>,
};
export const Icon = ({ n, ...p }) => <svg className="i" viewBox="0 0 24 24" {...p}>{P[n] || P.ai}</svg>;

export const AN_ICON = { cinto: 'seatbelt', passageiro: 'passenger', celular: 'phone', capacete: 'helmet', sobrecarga: 'overload', fumar: 'smoke',
  velocidade: 'speed', devagar: 'slow', contramao: 'wrongway', faixa: 'lane', estacionamento: 'parking', naomotor: 'bike', congest: 'jam', anpr: 'plate' };
export const GRUPOS = {
  cond: { n: 'Comportamento do condutor', c: 'var(--g-cond)', bg: 'var(--g-cond-bg)' },
  moto: { n: 'Motociclista', c: 'var(--g-moto)', bg: 'var(--g-moto-bg)' },
  circ: { n: 'Circulação', c: 'var(--g-circ)', bg: 'var(--g-circ-bg)' },
  traf: { n: 'Tráfego e leitura', c: 'var(--g-traf)', bg: 'var(--g-traf-bg)' },
};
const grp = (g) => GRUPOS[g] || { n: 'Outros', c: 'var(--muted)', bg: 'var(--mute-bg)' };

export function AnBadge({ chave, nome, grupo }) {
  const g = grp(grupo);
  return <span className="anb" style={{ color: g.c, background: g.bg }}><Icon n={AN_ICON[chave]} />{nome || chave || 'Sem mapeamento'}</span>;
}
export const groupOf = grp;

export function Plate({ p, lg }) {
  if (!p) return <span className={`plate none ${lg ? 'lg' : ''}`}><span className="bd">—</span><span className="num">N/LIDA</span></span>;
  return <span className={`plate ${lg ? 'lg' : ''}`}><span className="bd">BRASIL</span><span className="num">{p}</span></span>;
}

export const fmtDT = (t) => (t ? new Date(t).toLocaleString('pt-BR') .replace(',', '') : '—');
export const fmtT = (t) => (t ? new Date(t).toLocaleTimeString('pt-BR') : '—');
export const fmtD = (t) => (t ? new Date(t).toLocaleDateString('pt-BR') : '—');
export function ago(t) {
  const s = Math.round((Date.now() - new Date(t)) / 1000);
  if (s < 60) return `há ${Math.max(s, 0)} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

export const PRF = { na: ['st-mute', 'Não se aplica'], aguardando: ['st-mute', 'Aguarda validação'], fila: ['st-warn', 'Na fila'], enviado: ['st-ok', 'Enviado'], erro: ['st-bad', 'Erro no envio'] };
export const PrfBadge = ({ s }) => <span className={`badge ${(PRF[s] || PRF.na)[0]}`}>{(PRF[s] || PRF.na)[1]}</span>;

export const Head = ({ crumb, title, children }) => (
  <>
    <div className="crumb">Início › <b>{crumb}</b></div>
    <div className="ptitle"><h1>{title}</h1><div className="right">{children}</div></div>
  </>
);
