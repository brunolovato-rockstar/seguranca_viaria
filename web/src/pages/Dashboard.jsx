// Dashboard dos analíticos: abre no dia de hoje; o usuário pode trocar o período e a câmera.
// Gráficos em SVG próprio (sem biblioteca): barras empilhadas por grupo, mapa de calor
// analítico × hora, fluxo de leituras, ranking, funil de validação e placas reincidentes.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, media } from '../api.js';
import { bus } from '../App.jsx';
import { AN_ICON, AnBadge, Head, Icon, Plate, groupOf } from '../ui.jsx';
import EventModal from '../components/EventModal.jsx';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoje = () => iso(new Date());
const menos = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');
const fmtDia = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}${y !== String(new Date().getFullYear()) ? '/' + y.slice(2) : ''}`; };
const fmtDur = (s) => (s == null ? '—' : s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1).replace('.', ',')} h`);
const GRUPOS = [['cond', 'Condutor'], ['moto', 'Motociclista'], ['circ', 'Circulação']];
const PRESETS = [['hoje', 'Hoje', () => [hoje(), hoje()]], ['ontem', 'Ontem', () => [menos(1), menos(1)]],
  ['7', '7 dias', () => [menos(6), hoje()]], ['30', '30 dias', () => [menos(29), hoje()]]];

/** Largura real do container (os gráficos desenham em pixels, texto nítido). */
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Dica flutuante compartilhada pelos gráficos de um cartão. */
function useTip() {
  const [tip, setTip] = useState(null);
  const show = (e, content) => {
    const box = e.currentTarget.closest('.db-card').getBoundingClientRect();
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content, w: box.width });
  };
  const el = tip && (
    <div className="db-tip" style={{ left: Math.min(tip.x + 14, tip.w - 190), top: tip.y + 14 }}>{tip.content}</div>
  );
  return [show, () => setTip(null), el];
}

function Card({ title, sub, right, children, table, className = '' }) {
  const [tab, setTab] = useState(false);
  return (
    <section className={`panel db-card ${className}`}>
      <header className="db-ch">
        <div><h3>{title}</h3>{sub && <small>{sub}</small>}</div>
        <div className="db-cr">
          {right}
          {table && <button className={`db-lk ${tab ? 'on' : ''}`} onClick={() => setTab(!tab)}>{tab ? 'Gráfico' : 'Tabela'}</button>}
        </div>
      </header>
      <div className="db-cb">{tab ? <div className="db-table">{table}</div> : children}</div>
    </section>
  );
}

function Delta({ v, ant }) {
  if (!ant) return <span className="db-delta muted">sem base no período anterior</span>;
  const p = Math.round(((v - ant) / ant) * 100);
  return <span className="db-delta">{p > 0 ? '▲' : p < 0 ? '▼' : '='} {Math.abs(p)}% <span className="muted">vs período anterior ({fmtN(ant)})</span></span>;
}

function Kpi({ label, value, sub, onClick, bar }) {
  const T = onClick ? 'button' : 'div';
  return (
    <T className={`panel db-kpi ${onClick ? 'lk' : ''}`} onClick={onClick}>
      <small>{label}</small>
      <b>{value}</b>
      {bar != null && <span className="db-bar"><i style={{ width: `${Math.min(100, bar)}%` }} /></span>}
      <span className="db-ksub">{sub}</span>
    </T>
  );
}

/** Eixo Y "bonito": 0 .. máximo arredondado, 4 divisões. */
function ticks(max) {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}
const rotulo = (b, gran) => (gran === 'hora' ? `${String(b).padStart(2, '0')}h` : fmtDia(b));

/** Barras empilhadas por grupo (infrações por hora ou por dia). */
function Empilhadas({ serie, gran, onBar }) {
  const [ref, W] = useWidth();
  const [show, hide, tip] = useTip();
  const H = 240, L = 40, R = 8, T = 18, B = 26;
  const tot = serie.map((s) => GRUPOS.reduce((t, [g]) => t + s[g], 0));
  const tk = ticks(Math.max(...tot, 1));
  const max = tk[tk.length - 1];
  const n = serie.length;
  const bw = (W - L - R) / n;
  const barW = Math.max(3, Math.min(34, bw * 0.62));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const pico = tot.indexOf(Math.max(...tot));
  const cada = Math.ceil(n / Math.floor((W - L) / (gran === 'hora' ? 34 : 46))); // rótulos do eixo X sem encavalar
  const temPico = tot[pico] > 0;
  // o rótulo do pico sempre aparece; os vizinhos que encostariam nele ficam de fora
  const mostra = (i) => (temPico && i === pico) || (i % cada === 0 && (!temPico || Math.abs(i - pico) >= cada));
  return (
    <div ref={ref} className="db-plot" onMouseLeave={hide}>
      <svg width={W} height={H} role="img" aria-label="Infrações por período, empilhadas por grupo">
        {tk.map((v) => (
          <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="db-grid" /><text x={L - 6} y={y(v) + 4} className="db-ax" textAnchor="end">{fmtN(v)}</text></g>
        ))}
        {serie.map((s, i) => {
          const cx = L + bw * i + bw / 2;
          let acc = 0;
          const segs = GRUPOS.filter(([g]) => s[g] > 0);
          return (
            <g key={s.b} className="db-hit" onMouseMove={(e) => show(e, (
              <>
                <b>{gran === 'hora' ? `${String(s.b).padStart(2, '0')}:00 – ${String(s.b).padStart(2, '0')}:59` : fmtDia(s.b)}</b>
                {GRUPOS.map(([g, nm]) => <div key={g} className="db-tr"><i style={{ background: `var(--v-${g})` }} />{nm}<span>{fmtN(s[g])}</span></div>)}
                <div className="db-tr tot">Total<span>{fmtN(tot[i])}</span></div>
              </>
            ))} onClick={() => tot[i] && onBar?.(s.b)}>
              <rect x={L + bw * i} y={T} width={bw} height={H - T - B} fill="transparent" />
              {segs.map(([g], k) => {
                const y1 = y(acc + s[g]), y0 = y(acc);
                acc += s[g];
                const top = k === segs.length - 1;
                const h = Math.max(1, y0 - y1 - (top ? 0 : 2)); // 2px de respiro entre segmentos
                return <path key={g} fill={`var(--v-${g})`} d={barPath(cx - barW / 2, y1, barW, h, top ? 3 : 0)} />;
              })}
              {mostra(i) && <text x={cx} y={H - 8} className={`db-ax ${i === pico && tot[i] ? 'pk' : ''}`} textAnchor="middle">{rotulo(s.b, gran)}</text>}
            </g>
          );
        })}
        {tot[pico] > 0 && <text x={L + bw * pico + bw / 2} y={y(tot[pico]) - 6} textAnchor="middle" className="db-lbl">{fmtN(tot[pico])}</text>}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="db-base" />
      </svg>
      {tip}
    </div>
  );
}
/** Retângulo com cantos de cima arredondados (base reta no eixo). */
function barPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Linha/área de uma série (fluxo de leituras de placa). */
function Fluxo({ serie, gran, campo = 'anpr' }) {
  const [ref, W] = useWidth();
  const [hov, setHov] = useState(null);
  const H = 170, L = 40, R = 10, T = 14, B = 24;
  const vals = serie.map((s) => s[campo]);
  const tk = ticks(Math.max(...vals, 1));
  const max = tk[tk.length - 1];
  const n = serie.length;
  const x = (i) => L + ((W - L - R) * i) / Math.max(1, n - 1);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const cada = Math.ceil(n / Math.floor((W - L) / (gran === 'hora' ? 40 : 46)));
  const mover = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - L) / (W - L - R)) * (n - 1));
    setHov(i >= 0 && i < n ? i : null);
  };
  return (
    <div ref={ref} className="db-plot">
      <svg width={W} height={H} onMouseMove={mover} onMouseLeave={() => setHov(null)} role="img" aria-label="Leituras de placa por período">
        {tk.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="db-grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="db-ax">{fmtN(v)}</text></g>)}
        <polygon points={`${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}`} className="db-area" />
        <polyline points={pts} className="db-line" />
        {serie.map((s, i) => i % cada === 0 && <text key={s.b} x={x(i)} y={H - 7} textAnchor="middle" className="db-ax">{rotulo(s.b, gran)}</text>)}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="db-base" />
        {hov != null && (
          <g>
            <line x1={x(hov)} x2={x(hov)} y1={T} y2={H - B} className="db-cross" />
            <circle cx={x(hov)} cy={y(vals[hov])} r={5} className="db-dot" />
            <g transform={`translate(${Math.min(x(hov) + 10, W - 130)},${T + 4})`}>
              <rect width="120" height="38" rx="4" className="db-tipbox" />
              <text x="10" y="16" className="db-tipt">{gran === 'hora' ? `${String(serie[hov].b).padStart(2, '0')}:00` : fmtDia(serie[hov].b)}</text>
              <text x="10" y="31" className="db-tipv">{fmtN(vals[hov])} leituras</text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

/** Mapa de calor: analítico × hora do dia (cor sequencial de um só tom). */
function Calor({ heat, analiticos, onCell }) {
  const [ref, W] = useWidth();
  const [show, hide, tip] = useTip();
  const linhas = analiticos.filter((a) => a.infracao && a.n > 0);
  const max = Math.max(1, ...heat.map((h) => h.n));
  const L = 168, cell = Math.max(10, Math.floor((W - L - 2 * 24) / 24)), ch = 24; // 2px de espaço entre células
  const val = (k, h) => heat.find((x) => x.chave === k && x.h === h)?.n || 0;
  if (!linhas.length) return <div className="db-empty">Nenhuma infração no período.</div>;
  return (
    <div ref={ref} className="db-plot" onMouseLeave={hide}>
      <div className="db-heat" style={{ gridTemplateColumns: `${L}px repeat(24, ${cell}px)` }}>
        {linhas.map((a) => (
          <div key={a.chave} className="db-hrow" style={{ display: 'contents' }}>
            <span className="db-hl" style={{ color: groupOf(a.grupo).c }}><Icon n={AN_ICON[a.chave]} /><span>{a.nome}</span></span>
            {Array.from({ length: 24 }, (_, h) => {
              const v = val(a.chave, h);
              const p = v ? 12 + Math.round((v / max) * 88) : 0;
              return (
                <span key={h} className={`db-hc ${v ? 'on' : ''}`} style={{ height: ch, background: v ? `color-mix(in oklab, var(--v-seq) ${p}%, var(--panel))` : undefined }}
                  onMouseMove={(e) => show(e, <><b>{a.nome}</b><div className="db-tr">{String(h).padStart(2, '0')}:00 – {String(h).padStart(2, '0')}:59<span>{fmtN(v)}</span></div></>)}
                  onClick={() => v && onCell?.(a.chave)} />
              );
            })}
          </div>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="db-hx">{h % 3 === 0 ? `${h}h` : ''}</span>)}
      </div>
      <div className="db-scale"><span>menos</span><i style={{ background: 'linear-gradient(90deg, color-mix(in oklab, var(--v-seq) 12%, var(--panel)), var(--v-seq))' }} /><span>mais ({fmtN(max)})</span></div>
      {tip}
    </div>
  );
}

/** Lista com barra horizontal (ranking). */
function Ranking({ itens, max, cor, onClick }) {
  return (
    <div className="db-rank">
      {itens.map((it) => (
        <button key={it.k} className="db-rk" onClick={() => onClick?.(it)} disabled={!onClick}>
          <span className="db-rkl">{it.label}</span>
          <span className="db-rkv">{fmtN(it.n)}{it.extra}</span>
          <span className="db-rkb"><i style={{ width: `${Math.max(1.5, (it.n / max) * 100)}%`, background: it.cor || cor }} /></span>
        </button>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const [per, setPer] = useState({ de: hoje(), ate: hoje(), preset: 'hoje' });
  const [cam, setCam] = useState('');
  const [cams, setCams] = useState([]);
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const [quando, setQuando] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => { api('/cameras').then(setCams).catch(() => {}); }, []);
  const load = useCallback(() => {
    const qs = new URLSearchParams({ de: per.de, ate: per.ate, ...(cam ? { camera: cam } : {}) });
    return api(`/dashboard?${qs}`).then((r) => { setD(r); setErro(''); setQuando(new Date()); }).catch((e) => setErro(e.message));
  }, [per.de, per.ate, cam]);
  useEffect(() => { load(); }, [load]);

  // período que inclui hoje: atualiza sozinho quando chegam detecções (no máx. a cada 5 s)
  const aoVivo = per.ate >= hoje();
  useEffect(() => {
    if (!aoVivo) return undefined;
    let t = null;
    const on = () => { if (!t) t = setTimeout(() => { t = null; load(); }, 5000); };
    bus.addEventListener('evento', on);
    return () => { clearTimeout(t); bus.removeEventListener('evento', on); };
  }, [aoVivo, load]);

  const preset = (k) => { const p = PRESETS.find((x) => x[0] === k); const [de, ate] = p[2](); setPer({ de, ate, preset: k }); };
  const regs = (extra = {}) => {
    const qs = new URLSearchParams({ de: per.de, ate: per.ate, ...(cam ? { camera: cam } : {}), ...extra });
    nav(`/registros?${qs}`);
  };

  const k = d?.kpis || {}, ka = d?.kpisAnterior || {};
  const gran = d?.periodo.granularidade;
  const infr = useMemo(() => (d?.analiticos || []).filter((a) => a.infracao), [d]);
  const maxInf = Math.max(1, ...infr.map((a) => a.n));
  const semAnpr = infr.map((a) => a.chave).join(','); // "só infrações" no filtro de Registros
  const totTipos = (d?.tipos || []).reduce((t, x) => t + x.n, 0);
  const pico = useMemo(() => {
    if (!d) return null;
    const tot = d.serie.map((s) => s.cond + s.moto + s.circ);
    const m = Math.max(...tot);
    return m ? { b: d.serie[tot.indexOf(m)].b, n: m } : null;
  }, [d]);
  const semAnpr0 = d?.anpr_gravado === false; // SALVAR_ANPR=0 no servidor
  const indice = k.anpr && !semAnpr0 ? (k.infracoes / k.anpr) * 1000 : null;
  const periodoTxt = d ? (d.periodo.dias === 1 ? (per.de === hoje() ? 'hoje' : fmtDia(per.de)) : `${fmtDia(per.de)} a ${fmtDia(per.ate)}`) : '';

  return (
    <>
      <Head crumb="Monitoramento" title="Dashboard">
        {quando && <span className="db-upd">{aoVivo && <i className="db-live" />}Atualizado às {quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
      </Head>

      <div className="panel db-filters">
        <div className="segtabs">
          {PRESETS.map(([key, nm]) => <button key={key} className={per.preset === key ? 'on' : ''} onClick={() => preset(key)}>{nm}</button>)}
        </div>
        <label>De <input type="date" value={per.de} max={per.ate} onChange={(e) => e.target.value && setPer({ ...per, de: e.target.value, preset: '' })} /></label>
        <label>Até <input type="date" value={per.ate} min={per.de} max={hoje()} onChange={(e) => e.target.value && setPer({ ...per, ate: e.target.value, preset: '' })} /></label>
        <label>Câmera <select value={cam} onChange={(e) => setCam(e.target.value)}><option value="">Todas</option>{cams.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nome}</option>)}</select></label>
        {erro && <span className="db-err">{erro}</span>}
      </div>

      {!d ? <div className="panel empty">{erro || 'Carregando…'}</div> : (
        <div className="db">
          <div className="db-kpis">
            <Kpi label="Infrações detectadas" value={fmtN(k.infracoes)} sub={<Delta v={k.infracoes} ant={ka.infracoes} />} onClick={() => regs({ chaves: semAnpr })} />
            <Kpi label="Placas lidas (ANPR)" value={semAnpr0 ? '—' : fmtN(k.anpr)} sub={semAnpr0 ? 'leituras de placa não são gravadas neste servidor' : <Delta v={k.anpr} ant={ka.anpr} />} onClick={semAnpr0 ? undefined : () => regs({ chaves: 'anpr' })} />
            <Kpi label="Infrações por 1.000 placas" value={indice == null ? '—' : indice.toLocaleString('pt-BR', { maximumFractionDigits: indice < 10 ? 1 : 0 })}
              sub={indice == null ? (semAnpr0 ? 'depende das leituras de placa (ANPR desligado)' : 'sem leituras de placa no período') : `${fmtN(k.placas_infratoras)} placas diferentes autuadas`} />
            <Kpi label="Aguardando validação" value={fmtN(k.aguardando)} sub={pico ? `pico às ${gran === 'hora' ? `${pico.b}h` : fmtDia(pico.b)} (${fmtN(pico.n)} infrações)` : '—'}
              onClick={() => regs({ validacao: 'aguardando', chaves: semAnpr })} />
            <Kpi label="Validadas" value={fmtN(k.validados)} bar={k.infracoes ? (k.validados / k.infracoes) * 100 : 0}
              sub={k.infracoes ? `${Math.round((k.validados / k.infracoes) * 100)}% das infrações` : '—'} onClick={() => regs({ validacao: 'validado' })} />
            <Kpi label="Enviadas à PRF" value={fmtN(k.enviados)} sub={k.erro_prf ? `${fmtN(k.erro_prf)} com erro no envio` : 'integração em fase futura'} />
          </div>

          <div className="db-row r21">
            <Card title={gran === 'hora' ? 'Infrações ao longo do dia' : 'Infrações por dia'} sub={`Por grupo de analítico · ${periodoTxt}${gran === 'hora' ? ' · clique numa barra para ver os registros' : ''}`}
              right={<div className="db-leg">{GRUPOS.map(([g, nm]) => <span key={g}><i style={{ background: `var(--v-${g})` }} />{nm}</span>)}</div>}
              table={<table><thead><tr><th>{gran === 'hora' ? 'Hora' : 'Dia'}</th>{GRUPOS.map(([g, nm]) => <th key={g}>{nm}</th>)}<th>Total</th></tr></thead>
                <tbody>{d.serie.map((s) => <tr key={s.b}><td>{rotulo(s.b, gran)}</td>{GRUPOS.map(([g]) => <td key={g}>{fmtN(s[g])}</td>)}<td><b>{fmtN(s.cond + s.moto + s.circ)}</b></td></tr>)}</tbody></table>}>
              <Empilhadas serie={d.serie} gran={gran} onBar={(b) => (gran === 'dia' ? regs({ de: b, ate: b, chaves: semAnpr }) : regs({ chaves: semAnpr }))} />
            </Card>
            <Card title="Ranking de infrações" sub="Clique para abrir os registros">
              {infr.some((a) => a.n) ? (
                <Ranking max={maxInf} onClick={(it) => regs({ chaves: it.k })}
                  itens={infr.filter((a) => a.n).map((a) => ({
                    k: a.chave, n: a.n, cor: `var(--v-${a.grupo})`,
                    label: <><Icon n={AN_ICON[a.chave]} style={{ color: groupOf(a.grupo).c }} />{a.nome}</>,
                    extra: a.anterior ? <small className={`db-var ${a.n >= a.anterior ? 'up' : 'dn'}`}>{a.n >= a.anterior ? '▲' : '▼'}{Math.abs(Math.round(((a.n - a.anterior) / a.anterior) * 100))}%</small> : null,
                  }))} />
              ) : <div className="db-empty">Nenhuma infração no período.</div>}
              {infr.some((a) => !a.n) && <p className="db-zero">Sem ocorrência: {infr.filter((a) => !a.n).map((a) => a.nome).join(' · ')}</p>}
            </Card>
          </div>

          <Card title="Quando cada infração acontece" sub={`Analítico × hora do dia${d.periodo.dias > 1 ? ` · soma dos ${d.periodo.dias} dias` : ''} · clique numa célula para ver os registros`}
            table={<table><thead><tr><th>Analítico</th>{Array.from({ length: 24 }, (_, h) => <th key={h}>{h}h</th>)}</tr></thead>
              <tbody>{infr.filter((a) => a.n).map((a) => <tr key={a.chave}><td>{a.nome}</td>{Array.from({ length: 24 }, (_, h) => <td key={h}>{d.heat.find((x) => x.chave === a.chave && x.h === h)?.n || ''}</td>)}</tr>)}</tbody></table>}>
            <Calor heat={d.heat} analiticos={d.analiticos} onCell={(chave) => regs({ chaves: chave })} />
          </Card>

          <div className="db-row r3">
            <Card title="Fluxo de placas lidas" sub={`Leituras ANPR ${gran === 'hora' ? 'por hora' : 'por dia'} · indica o movimento da via`}>
              {k.anpr && !semAnpr0 ? <Fluxo serie={d.serie} gran={gran} /> : <div className="db-empty">{semAnpr0 ? 'Leituras de placa não são gravadas neste servidor (SALVAR_ANPR=0).' : 'Sem leituras de placa no período.'}</div>}
            </Card>
            <Card title="Funil de validação" sub="Da detecção ao envio para a PRF">
              <div className="db-funil">
                {[['Detectadas', k.infracoes, null], ['Validadas', k.validados, () => regs({ validacao: 'validado' })], ['Enviadas à PRF', k.enviados, null]].map(([nm, v, fn], i) => (
                  <button key={nm} className="db-fn" onClick={fn || undefined} disabled={!fn}>
                    <span className="db-fnb" style={{ width: `${k.infracoes ? Math.max(2, (v / k.infracoes) * 100) : 0}%`, opacity: 1 - i * 0.22 }} />
                    <span className="db-fnt">{nm}<b>{fmtN(v)}</b>{i > 0 && k.infracoes > 0 && <small>{Math.round((v / k.infracoes) * 100)}%</small>}</span>
                  </button>
                ))}
              </div>
              <div className="db-fnx">
                <span>Aguardando<b>{fmtN(k.aguardando)}</b></span>
                <span>Descartadas<b>{fmtN(k.descartados)}</b></span>
                <span>Placas corrigidas<b>{fmtN(k.corrigidas)}</b></span>
              </div>
            </Card>
            <Card title="Veículos autuados" sub="Tipo de veículo nas infrações">
              {totTipos ? <Ranking max={Math.max(...d.tipos.map((t) => t.n))} cor="var(--v-seq)"
                itens={d.tipos.slice(0, 7).map((t) => ({ k: t.t, n: t.n, label: t.t, extra: <small className="muted"> · {Math.round((t.n / totTipos) * 100)}%</small> }))} />
                : <div className="db-empty">Sem infrações no período.</div>}
            </Card>
          </div>

          <div className="db-row r3">
            <Card title="Placas reincidentes" sub="2 ou mais infrações no período · clique para abrir a última">
              {d.reincidentes.length ? (
                <div className="db-reinc">
                  {d.reincidentes.map((r) => (
                    <button key={r.placa} className="db-ri" onClick={() => setOpen({ id: r.ultimo_id, ids: d.reincidentes.map((x) => x.ultimo_id) })}>
                      <Plate p={r.placa} />
                      <span className="db-rin"><b>{r.n}</b> infrações</span>
                      <span className="db-ric">{r.chaves.map((c) => <Icon key={c} n={AN_ICON[c]} style={{ color: groupOf(d.analiticos.find((a) => a.chave === c)?.grupo).c }} />)}</span>
                    </button>
                  ))}
                </div>
              ) : <div className="db-empty">Nenhuma placa com mais de uma infração no período.</div>}
            </Card>
            <Card title="Velocidade medida" sub="Todas as passagens com velocidade, faixas de 10 km/h">
              {d.velocidade.length ? <Ranking max={Math.max(...d.velocidade.map((v) => v.n))} cor="var(--v-seq)"
                itens={d.velocidade.map((v) => ({ k: v.faixa, n: v.n, label: v.faixa >= 150 ? '150+ km/h' : `${v.faixa}–${v.faixa + 9} km/h` }))} />
                : <div className="db-empty">A câmera não enviou velocidade no período (sem radar ou calibração).</div>}
            </Card>
            <Card title="Validação por usuário" sub="Quem validou e o tempo médio entre a detecção e a validação">
              {d.validadores.length ? (
                <div className="db-val">
                  {d.validadores.map((v) => (
                    <div key={v.usuario}><span className="db-av">{(v.nome || v.usuario).split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                      <span className="db-vn"><b>{v.nome}</b><small>{v.usuario}</small></span>
                      <span className="db-vv"><b>{fmtN(v.n)}</b><small>espera média {fmtDur(v.espera_s)}</small></span></div>
                  ))}
                </div>
              ) : <div className="db-empty">Nenhuma validação no período.</div>}
            </Card>
          </div>

          {d.cameras.length > 1 && (
            <Card title="Por câmera">
              <Ranking max={Math.max(...d.cameras.map((c) => c.inf), 1)} cor="var(--v-seq)" onClick={(it) => { setCam(String(it.k)); }}
                itens={d.cameras.map((c) => ({ k: c.id, n: c.inf, label: `${c.codigo} · ${c.nome}`, extra: <small className="muted"> · {fmtN(c.anpr)} placas</small> }))} />
            </Card>
          )}

          <Card title="Últimas infrações" sub={periodoTxt} right={<button className="db-lk" onClick={() => regs({ chaves: semAnpr })}>Ver todas</button>}>
            {d.ultimas.length ? (
              <div className="db-last">
                {d.ultimas.map((e) => (
                  <button key={e.id} className="db-li" onClick={() => setOpen({ id: e.id, ids: d.ultimas.map((x) => x.id) })}>
                    {e.img ? <img src={media(e.img)} alt="" loading="lazy" /> : <span className="noimg" />}
                    <AnBadge chave={e.chave} nome={e.analitico_nome} grupo={e.analitico_grupo} />
                    <span className="db-lt">{new Date(e.ocorrido_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{e.placa && <span className="mono"> · {e.placa}</span>}</span>
                  </button>
                ))}
              </div>
            ) : <div className="db-empty">Nenhuma infração no período.</div>}
          </Card>
        </div>
      )}
      {open && <EventModal id={open.id} ids={open.ids} onClose={() => setOpen(null)} onChange={() => load()} />}
    </>
  );
}
