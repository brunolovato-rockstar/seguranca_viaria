import { useEffect, useState, useCallback, useRef } from 'react';
import { api, media } from '../api.js';
import { useSearchParams } from 'react-router-dom';
import { bus } from '../App.jsx';
import { AN_ICON, AnBadge, Head, Icon, Plate, PrfBadge, fmtDT, fmtD, fmtT, groupOf } from '../ui.jsx';
import EventModal from '../components/EventModal.jsx';

const VAZIO = { de: '', ate: '', camera: '', chaves: '', placa: '', validacao: '', prf: '',
  tipo_veiculo: '', marca: '', cor: '', faixa: '', sentido: '', vel_min: '', vel_max: '', placa_corrigida: '' };
const EXTRAS = ['tipo_veiculo', 'marca', 'cor', 'faixa', 'sentido', 'vel_min', 'vel_max', 'prf', 'placa_corrigida'];
const PRF = [['aguardando', 'Aguarda validação'], ['fila', 'Na fila'], ['enviado', 'Enviado'], ['erro', 'Erro no envio'], ['na', 'Não se aplica']];

const Opc = ({ lista, todos = 'Todos' }) => <><option value="">{todos}</option>{(lista || []).map((o) => <option key={o.v} value={o.v}>{o.v} ({o.n})</option>)}</>;

/** Filtro de analíticos com checkbox. Nada marcado = todos. Aplica na hora. */
function FiltroAnalitico({ ans, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const sel = new Set(value ? value.split(',') : []);
  useEffect(() => {
    if (!open) return undefined;
    const out = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [open]);
  const emit = (set) => onChange(set.size === 0 || set.size === ans.length ? '' : [...set].join(','));
  const toggle = (k) => {
    const n = new Set(sel.size ? sel : ans.map((a) => a.chave)); // nada marcado = todos marcados
    n.has(k) ? n.delete(k) : n.add(k);
    emit(n);
  };
  const marcado = (k) => !sel.size || sel.has(k);
  const nomes = ans.filter((a) => sel.has(a.chave)).map((a) => a.nome);
  const semAnpr = sel.size === ans.length - 1 && !sel.has('anpr');
  const infr = ans.filter((a) => a.infracao).map((a) => a.chave);
  const soInfr = infr.length > 0 && sel.size === infr.length && infr.every((k) => sel.has(k));
  const rotulo = !sel.size ? 'Todos' : soInfr ? 'Só infrações' : semAnpr ? 'Todos, exceto ANPR' : nomes.length === 1 ? nomes[0] : `${nomes.length} selecionados`;
  return (
    <div className="msel" ref={ref}>
      <button type="button" className={`msel-btn ${sel.size ? 'on' : ''}`} onClick={() => setOpen(!open)} title={nomes.join(', ')}>
        <span>{rotulo}</span><Icon n="down" />
      </button>
      {open && (
        <div className="popover msel-pop">
          <div className="pop-h"><b>Analíticos</b><span className="muted">registros hoje</span></div>
          <div className="msel-list">
            {ans.map((a) => {
              const g = groupOf(a.grupo);
              return (
                <label key={a.chave} className="msel-row">
                  <input type="checkbox" checked={marcado(a.chave)} onChange={() => toggle(a.chave)} />
                  <Icon n={AN_ICON[a.chave]} style={{ color: g.c }} />
                  <span className="nm">{a.nome}</span>
                  <small className="muted">{a.hoje || 0}</small>
                  <button type="button" className="so" onClick={(e) => { e.preventDefault(); onChange(a.chave); }} title={`Mostrar só ${a.nome}`}>só</button>
                </label>
              );
            })}
          </div>
          <div className="pop-f">
            <button type="button" className="btn sm" onClick={() => onChange('')}>Todos</button>
            <button type="button" className="btn sm" onClick={() => emit(new Set(ans.filter((a) => a.chave !== 'anpr').map((a) => a.chave)))}>Sem ANPR</button>
            <button type="button" className="btn sm" onClick={() => onChange(infr.join(','))}>Só infrações</button>
            <button type="button" className="btn sm" onClick={() => onChange('anpr')}>Só ANPR</button>
            <button type="button" className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(false)}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Registros() {
  const [tab, setTab] = useState('lista');
  return (
    <>
      <Head crumb="Monitoramento" title="Registros">
        <div className="segtabs">
          <button className={tab === 'lista' ? 'on' : ''} onClick={() => setTab('lista')}>Registros</button>
          <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}><Icon n="history" style={{ width: 15, height: 15 }} />Log de alterações</button>
        </div>
      </Head>
      {tab === 'lista' ? <Lista /> : <LogAlteracoes />}
    </>
  );
}

function Lista() {
  const [params] = useSearchParams();
  const inicial = Object.fromEntries(Object.keys(VAZIO).map((k) => [k, params.get(k) || ''])); // filtros vindos de links (Mapa, Analíticos)
  const [f, setF] = useState(inicial);
  const [applied, setApplied] = useState(inicial);
  const [opc, setOpc] = useState({});
  const [mais, setMais] = useState(() => EXTRAS.some((k) => inicial[k]));
  const nExtras = EXTRAS.filter((k) => applied[k]).length;
  useEffect(() => { api('/eventos/opcoes').then(setOpc).catch(() => {}); }, []);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, resumo: [] });
  const [cams, setCams] = useState([]);
  const [ans, setAns] = useState([]);
  const [open, setOpen] = useState(null);
  const size = 15;

  const load = useCallback(() => {
    const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)), page, size });
    api(`/eventos?${qs}`).then(setData);
  }, [applied, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/cameras').then(setCams); api('/analiticos').then(setAns); }, []);
  useEffect(() => {
    const on = () => page === 1 && load();
    bus.addEventListener('evento', on);
    return () => bus.removeEventListener('evento', on);
  }, [load, page]);

  const validar = async (id) => { await api(`/eventos/${id}/validar`, { method: 'POST' }); load(); };
  const pages = Math.max(1, Math.ceil(data.total / size));
  const cnt = (k) => data.resumo.filter((r) => k.includes(r.chave)).reduce((s, r) => s + Number(r.n), 0);
  const aguard = data.resumo.reduce((s, r) => s + Number(r.aguardando || 0), 0);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <div className="kpis">
        <div className="panel kpi"><small>Total no filtro</small><b>{data.total}</b></div>
        <div className="panel kpi"><small>Sem cinto</small><b>{cnt(['cinto', 'passageiro'])}</b></div>
        <div className="panel kpi"><small>Uso de celular</small><b>{cnt(['celular'])}</b></div>
        <div className="panel kpi"><small>Sem capacete</small><b>{cnt(['capacete'])}</b></div>
        <div className="panel kpi"><small>Aguardando validação</small><b>{aguard}</b></div>
      </div>
      <div className="panel">
        <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(f); }}>
          <div className="f"><label>De</label><input type="date" value={f.de} onChange={set('de')} /></div>
          <div className="f"><label>Até</label><input type="date" value={f.ate} onChange={set('ate')} /></div>
          <div className="f"><label>Câmera</label><select value={f.camera} onChange={set('camera')}><option value="">Todas</option>{cams.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nome}</option>)}</select></div>
          <div className="f"><label>Analítico</label><FiltroAnalitico ans={ans} value={f.chaves} onChange={(v) => { setF({ ...f, chaves: v }); setApplied({ ...applied, chaves: v }); setPage(1); }} /></div>
          <div className="f"><label>Placa</label><input value={f.placa} onChange={set('placa')} placeholder="ABC1D23" style={{ width: 120 }} /></div>
          <div className="f"><label>Validação</label><select value={f.validacao} onChange={set('validacao')}><option value="">Todas</option><option value="aguardando">Aguardando</option><option value="validado">Validados</option></select></div>
          <button type="button" className={`btn ${mais || nExtras ? 'on' : ''}`} onClick={() => setMais(!mais)}><Icon n="down" style={{ transform: mais ? 'rotate(180deg)' : 'none' }} />Mais filtros{nExtras > 0 && <span className="cnt">{nExtras}</span>}</button>
          <button className="btn pri">Filtrar</button>
          <button type="button" className="btn" onClick={() => { setF(VAZIO); setApplied(VAZIO); setPage(1); }}>Limpar</button>
          {mais && (
            <div className="filters-more">
              <div className="f"><label>Tipo de veículo</label><select value={f.tipo_veiculo} onChange={set('tipo_veiculo')}><Opc lista={opc.tipo_veiculo} /></select></div>
              <div className="f"><label>Marca</label><select value={f.marca} onChange={set('marca')}><Opc lista={opc.marca} todos="Todas" /></select></div>
              <div className="f"><label>Cor</label><select value={f.cor} onChange={set('cor')}><Opc lista={opc.cor} todos="Todas" /></select></div>
              <div className="f"><label>Faixa</label><select value={f.faixa} onChange={set('faixa')}><Opc lista={opc.faixa} todos="Todas" /></select></div>
              {opc.sentido?.length > 0 && <div className="f"><label>Sentido</label><select value={f.sentido} onChange={set('sentido')}><Opc lista={opc.sentido} /></select></div>}
              <div className="f"><label>Velocidade (km/h)</label><div className="rng"><input type="number" min="0" value={f.vel_min} onChange={set('vel_min')} placeholder="de" /><span>–</span><input type="number" min="0" value={f.vel_max} onChange={set('vel_max')} placeholder="até" /></div></div>
              <div className="f"><label>Envio PRF</label><select value={f.prf} onChange={set('prf')}><option value="">Todos</option>{PRF.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
              <label className="chk"><input type="checkbox" checked={f.placa_corrigida === '1'} onChange={(e) => setF({ ...f, placa_corrigida: e.target.checked ? '1' : '' })} />Só placas corrigidas</label>
            </div>
          )}
        </form>
        <div className="tablewrap">
          <table>
            <thead><tr><th /><th>ID</th><th>Data/Hora</th><th>Câmera</th><th>Analítico</th><th>Placa</th><th>Veículo</th><th>Vel.</th><th>Validação</th><th>Envio PRF</th><th /></tr></thead>
            <tbody>
              {!data.items.length && <tr><td colSpan={11} className="empty">Nenhum registro.</td></tr>}
              {data.items.map((e) => (
                <tr key={e.id} className="click" onClick={() => setOpen(e.id)}>
                  <td><div className="im" style={{ backgroundImage: e.imagens[0] ? `url(${media(e.imagens[0].url)})` : 'none' }} /></td>
                  <td className="mono">#{e.id}</td>
                  <td className="mono">{fmtDT(e.ocorrido_em)}</td>
                  <td>{e.camera_codigo}</td>
                  <td><AnBadge chave={e.chave} nome={e.analitico_nome} grupo={e.analitico_grupo} /></td>
                  <td><Plate p={e.placa} />{e.placa_ocr && <span className="badge st-warn" style={{ marginLeft: 6 }} title={`OCR: ${e.placa_ocr}`}><Icon n="edit" /></span>}</td>
                  <td>{e.tipo_veiculo || '—'}<br /><small className="muted">{e.marca || ''}</small></td>
                  <td>{e.velocidade != null ? `${e.velocidade} km/h` : '—'}</td>
                  <td onClick={(ev) => ev.stopPropagation()}>
                    {e.status_validacao === 'validado'
                      ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="vbig sm"><Icon n="check" /></span><div><b style={{ color: 'var(--ok)', fontSize: 12.5 }}>{e.validado_por_usuario}</b><br /><small className="muted mono">{fmtD(e.validado_em)} {fmtT(e.validado_em)}</small></div></div>
                      : <button className="btn sm" onClick={() => validar(e.id)}><Icon n="check" />Validar</button>}
                  </td>
                  <td><PrfBadge s={e.status_prf} /></td>
                  <td><button className="btn sm"><Icon n="eye" />Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span>{data.total ? `${(page - 1) * size + 1}–${Math.min(page * size, data.total)} de ${data.total}` : '0 registros'}</span>
          <div className="pg"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button><span style={{ padding: '4px 8px' }}>{page} / {pages}</span><button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button></div>
        </div>
      </div>
      {open && <EventModal id={open} ids={data.items.map((x) => x.id)} onClose={() => { setOpen(null); load(); }} />}
    </>
  );
}

function LogAlteracoes() {
  const [tipo, setTipo] = useState('manual');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  useEffect(() => { api(`/eventos/log?tipo=${encodeURIComponent(tipo)}`).then(setRows); }, [tipo]);
  const ids = [...new Set(rows.map((r) => r.evento_id))];
  return (
    <div className="panel">
      <div className="filters">
        <div className="f"><label>Tipo</label><select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="manual">Ações de usuários</option><option value="Placa corrigida">Placa corrigida</option><option value="Validado">Validado</option><option value="todas">Tudo (inclui sistema)</option>
        </select></div>
        <span className="muted" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12.5 }}>{rows.length} entradas (últimas 300)</span>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Data/Hora</th><th>Registro</th><th>Analítico</th><th>Usuário</th><th>Ação</th><th>Detalhe</th></tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={6} className="empty">Nenhuma alteração.</td></tr>}
            {rows.map((l) => (
              <tr key={l.id} className="click" onClick={() => setOpen(l.evento_id)}>
                <td className="mono">{fmtDT(l.criado_em)}</td><td className="mono">#{l.evento_id}</td>
                <td><AnBadge chave={l.chave} nome={l.analitico_nome} grupo={l.analitico_grupo} /></td>
                <td className="mono">{l.usuario_txt}</td>
                <td><span className={`badge ${l.acao === 'Placa corrigida' ? 'st-warn' : l.acao === 'Validado' ? 'st-ok' : 'st-mute'}`}>{l.acao}</span></td>
                <td style={{ whiteSpace: 'normal' }}>{l.detalhe}{l.motivo && <i className="muted"> · {l.motivo}</i>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <EventModal id={open} ids={ids} onClose={() => setOpen(null)} />}
    </div>
  );
}
