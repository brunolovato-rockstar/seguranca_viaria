// Dashboard: números do período (padrão = hoje) para a tela de indicadores.
import express from 'express';
import { q, one } from '../db.js';
import { tipoPt } from '../dahua/normalize.js';
import { config } from '../config.js';

export const dashboardRouter = express.Router();

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dias = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000) + 1;
const N = (v) => Number(v || 0);

dashboardRouter.get('/', async (req, res, next) => {
  try {
    await montar(req, res);
  } catch (e) { next(e); }
});

// (GROUP BY sempre por colunas de subconsulta: compatível com ONLY_FULL_GROUP_BY do MySQL)
async function montar(req, res) {
  let de = ISO.test(req.query.de || '') ? req.query.de : hojeISO();
  let ate = ISO.test(req.query.ate || '') ? req.query.ate : de;
  if (ate < de) [de, ate] = [ate, de];
  const nDias = dias(de, ate);
  if (nDias > 366) return res.status(400).json({ erro: 'Escolha um período de até 1 ano.' });
  const cam = req.query.camera ? Number(req.query.camera) : null;

  // filtro base (período + câmera) — "e" = eventos, "a" = analiticos
  const where = (d1, d2) => {
    const w = ['e.ocorrido_em >= ?', 'e.ocorrido_em < ?'];
    const p = [`${d1} 00:00:00`, `${addDias(d2, 1)} 00:00:00`];
    if (cam) { w.push('e.camera_id = ?'); p.push(cam); }
    return { w: 'WHERE ' + w.join(' AND '), p };
  };
  const cur = where(de, ate);
  const antDe = addDias(de, -nDias), antAte = addDias(de, -1);
  const ant = where(antDe, antAte);
  const FROM = 'FROM eventos e LEFT JOIN analiticos a ON a.chave = e.chave';
  const INF = 'a.infracao = 1';

  const kpi = async (f) => one(`SELECT
      SUM(${INF}) infracoes,
      SUM(e.chave = 'anpr') anpr,
      COUNT(*) total,
      SUM(${INF} AND e.status_validacao = 'aguardando') aguardando,
      SUM(${INF} AND e.status_validacao = 'validado') validados,
      SUM(${INF} AND e.status_validacao = 'descartado') descartados,
      SUM(e.status_prf = 'enviado') enviados,
      SUM(e.status_prf = 'erro') erro_prf,
      SUM(e.placa_ocr IS NOT NULL) corrigidas,
      COUNT(DISTINCT CASE WHEN ${INF} THEN e.placa END) placas_infratoras
    ${FROM} ${f.w}`, f.p);

  const [k, kAnt] = await Promise.all([kpi(cur), kpi(ant)]);
  const nk = (o) => Object.fromEntries(Object.entries(o || {}).map(([x, v]) => [x, N(v)]));

  const porHora = nDias === 1;
  const bucket = porHora ? 'HOUR(e.ocorrido_em)' : 'DATE_FORMAT(e.ocorrido_em, "%Y-%m-%d")';

  const [analiticos, analiticosAnt, serie, heat, tipos, reinc, validadores, vel, ultimas, camerasRows] = await Promise.all([
    q(`SELECT a.chave, a.nome, a.grupo, a.infracao, COUNT(e.id) n ${FROM} ${cur.w} GROUP BY a.chave, a.nome, a.grupo, a.infracao ORDER BY n DESC`, cur.p),
    q(`SELECT e.chave, COUNT(*) n ${FROM} ${ant.w} GROUP BY e.chave`, ant.p),
    q(`SELECT t.b, t.grupo, SUM(t.inf) inf, SUM(t.anpr) anpr FROM (SELECT ${bucket} b, a.grupo, (${INF}) inf, (e.chave = 'anpr') anpr ${FROM} ${cur.w}) t GROUP BY t.b, t.grupo`, cur.p),
    q(`SELECT t.chave, t.h, COUNT(*) n FROM (SELECT a.chave, HOUR(e.ocorrido_em) h ${FROM} ${cur.w} AND ${INF}) t GROUP BY t.chave, t.h`, cur.p),
    q(`SELECT e.tipo_veiculo t, COUNT(*) n ${FROM} ${cur.w} AND ${INF} GROUP BY e.tipo_veiculo`, cur.p),
    q(`SELECT e.placa, COUNT(*) n, COUNT(DISTINCT e.chave) tipos, GROUP_CONCAT(DISTINCT e.chave) chaves, MAX(e.ocorrido_em) ultimo, MAX(e.id) ultimo_id
       ${FROM} ${cur.w} AND ${INF} AND e.placa IS NOT NULL AND e.placa <> '' GROUP BY e.placa HAVING n >= 2 ORDER BY n DESC, ultimo DESC LIMIT 10`, cur.p),
    q(`SELECT u.nome, u.usuario, COUNT(*) n, AVG(TIMESTAMPDIFF(SECOND, e.ocorrido_em, e.validado_em)) espera_s
       ${FROM} JOIN usuarios u ON u.id = e.validado_por ${cur.w} AND ${INF} AND e.status_validacao = 'validado' GROUP BY u.id, u.nome, u.usuario ORDER BY n DESC LIMIT 8`, cur.p),
    q(`SELECT t.faixa, SUM(t.inf) inf, COUNT(*) n FROM (SELECT LEAST(FLOOR(e.velocidade / 10) * 10, 150) faixa, (${INF}) inf ${FROM} ${cur.w} AND e.velocidade > 0) t GROUP BY t.faixa ORDER BY t.faixa`, cur.p),
    q(`SELECT e.id, e.chave, e.placa, e.ocorrido_em, a.nome analitico_nome, a.grupo analitico_grupo,
         (SELECT i.caminho FROM evento_imagens i WHERE i.evento_id = e.id ORDER BY i.id LIMIT 1) img
       ${FROM} ${cur.w} AND ${INF} ORDER BY e.ocorrido_em DESC, e.id DESC LIMIT 10`, cur.p),
    q(`SELECT c.id, c.codigo, c.nome, SUM(${INF}) inf, SUM(e.chave = 'anpr') anpr, COUNT(e.id) n
       FROM eventos e JOIN cameras c ON c.id = e.camera_id LEFT JOIN analiticos a ON a.chave = e.chave ${cur.w} GROUP BY c.id, c.codigo, c.nome ORDER BY inf DESC`, cur.p),
  ]);

  // tipos de veículo: junta valores antigos em inglês com os traduzidos
  const tiposMap = new Map();
  for (const r of tipos) {
    const t = r.t ? tipoPt(r.t) || 'Não identificado' : 'Não identificado';
    tiposMap.set(t, (tiposMap.get(t) || 0) + N(r.n));
  }
  const antMap = Object.fromEntries(analiticosAnt.map((r) => [r.chave, N(r.n)]));

  // série completa (horas 0-23 ou todos os dias do período), por grupo
  const chaves = porHora ? Array.from({ length: 24 }, (_, i) => i) : Array.from({ length: nDias }, (_, i) => addDias(de, i));
  const serieOut = chaves.map((b) => {
    const rows = serie.filter((r) => (porHora ? N(r.b) === b : r.b === b));
    const o = { b, cond: 0, moto: 0, circ: 0, traf: 0, anpr: 0 };
    for (const r of rows) { if (r.grupo && r.grupo in o) o[r.grupo] += N(r.inf); o.anpr += N(r.anpr); }
    return o;
  });

  res.json({
    anpr_gravado: config.salvarAnpr,
    periodo: { de, ate, dias: nDias, granularidade: porHora ? 'hora' : 'dia', anterior: { de: antDe, ate: antAte } },
    kpis: nk(k),
    kpisAnterior: nk(kAnt),
    analiticos: analiticos.filter((r) => r.chave).map((r) => ({ ...r, n: N(r.n), anterior: antMap[r.chave] || 0 })),
    serie: serieOut,
    heat: heat.map((r) => ({ chave: r.chave, h: N(r.h), n: N(r.n) })),
    tipos: [...tiposMap].map(([t, n]) => ({ t, n })).sort((a, b) => b.n - a.n),
    reincidentes: reinc.map((r) => ({ placa: r.placa, n: N(r.n), tipos: N(r.tipos), chaves: String(r.chaves || '').split(','), ultimo: r.ultimo, ultimo_id: r.ultimo_id })),
    validadores: validadores.map((r) => ({ nome: r.nome, usuario: r.usuario, n: N(r.n), espera_s: r.espera_s == null ? null : Math.round(N(r.espera_s)) })),
    velocidade: vel.map((r) => ({ faixa: N(r.faixa), n: N(r.n), inf: N(r.inf) })),
    ultimas: ultimas.map((r) => ({ ...r, img: r.img ? `/media/${String(r.img).replace(/\\/g, '/')}` : null })),
    cameras: camerasRows.map((r) => ({ ...r, inf: N(r.inf), anpr: N(r.anpr), n: N(r.n) })),
  });
}
