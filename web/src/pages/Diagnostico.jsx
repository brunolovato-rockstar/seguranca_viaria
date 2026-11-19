// Diagnóstico da integração: estado de cada câmera e tudo o que chega dela (inclusive códigos ainda não mapeados).
import { Fragment, useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';
import { bus, useApp } from '../App.jsx';
import { Head, Icon, ago, fmtDT } from '../ui.jsx';
import { getToken } from '../api.js';

function Integracao() {
  const [d, setD] = useState({ rows: [], codigos: [] });
  const [cams, setCams] = useState([]);
  const [status, setStatus] = useState({});
  const [sel, setSel] = useState(null);
  const [full, setFull] = useState(null);
  useEffect(() => { setFull(null); if (sel) api(`/diagnostico/brutos/${sel}`).then(setFull); }, [sel]);
  const copiar = () => navigator.clipboard?.writeText(full?.payload || '').then(() => alert('Texto copiado.'));
  const load = () => {
    api('/diagnostico/brutos?limit=100').then(setD);
    Promise.all([api('/cameras'), api('/cameras/status')]).then(([c, s]) => { setCams(c); setStatus(s); });
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    const on = (e) => setStatus((s) => ({ ...s, [e.detail.camera_id]: e.detail.status }));
    bus.addEventListener('camera_status', on);
    return () => { clearInterval(t); bus.removeEventListener('camera_status', on); };
  }, []);

  return (
    <>
      <div className="kpis">
        {cams.map((c) => {
          const s = status[c.id] || {};
          return (
            <div key={c.id} className="panel kpi">
              <small>{c.codigo} · {c.url_base}</small>
              <b style={{ fontSize: 18, color: s.estado === 'online' ? 'var(--ok)' : s.estado === 'erro' ? 'var(--bad)' : 'var(--warn)' }}>{s.estado || '—'}</b>
              <small>{s.ultimoHeartbeat ? `heartbeat ${ago(s.ultimoHeartbeat)}` : ''}{s.eventos ? ` · ${s.eventos} eventos nesta sessão` : ''}</small>
              {s.erro && <small style={{ display: 'block', color: 'var(--bad)' }}>{s.erro}</small>}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '440px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="panel">
          <div className="panel-h">Códigos recebidos</div>
          <table>
            <thead><tr><th>Código</th><th>Qtde</th><th>Situação</th></tr></thead>
            <tbody>
              {!d.codigos.length && <tr><td colSpan={3} className="empty">Nada recebido ainda.</td></tr>}
              {d.codigos.map((c) => (
                <tr key={c.codigo}><td className="mono" style={{ fontSize: 12.5 }}>{c.codigo}</td><td>{c.n}</td>
                  <td>{Number(c.sem_mapa) === Number(c.n) ? <span className="badge st-warn" title="Inclua em analitico_codigos para virar registro">sem mapeamento</span> : <span className="badge st-ok">vira registro</span>}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <div className="panel-h">Últimas mensagens da câmera (brutas)</div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Recebido</th><th>Câmera</th><th>Origem</th><th>Código</th><th>Imagens</th><th>Registro</th></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="click" onClick={() => setSel(sel === r.id ? null : r.id)}>
                      <td className="mono">{fmtDT(r.recebido_em)}</td><td>{r.camera_codigo || '—'}</td><td>{r.origem}</td>
                      <td className="mono" style={{ fontSize: 12.5 }}>{r.codigo}</td><td>{r.imagens}</td>
                      <td>{r.evento_id ? <span className="mono">#{r.evento_id}</span> : <span className="muted" style={{ fontSize: 12 }}>{r.erro ? 'sem mapeamento' : '—'}</span>}</td>
                    </tr>
                    {sel === r.id && (
                      <tr><td colSpan={6} style={{ whiteSpace: 'normal' }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}><button className="btn sm" onClick={copiar} disabled={!full}>Copiar texto completo</button><span className="muted" style={{ fontSize: 12 }}>{full ? `${full.payload?.length || 0} caracteres` : 'carregando…'}</span></div>
                        <pre className="raw" style={{ maxHeight: 360 }}>{full?.payload || r.payload}</pre>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

const fmtUp = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}min` : `${m} min`; };

/** Botão que pede confirmação no segundo clique (sem janela do navegador). */
function Acao({ icon, children, confirmar, onRun, disabled, title }) {
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!arm) return undefined; const t = setTimeout(() => setArm(false), 4000); return () => clearTimeout(t); }, [arm]);
  const click = async () => {
    if (confirmar && !arm) { setArm(true); return; }
    setArm(false); setBusy(true);
    try { await onRun(); } finally { setBusy(false); }
  };
  return (
    <button className={`btn ${arm ? 'warn' : ''}`} onClick={click} disabled={disabled || busy} title={title}>
      <Icon n={icon} />{busy ? 'Aguarde…' : arm ? confirmar : children}
    </button>
  );
}

function Sistema() {
  const { toast } = useApp();
  const [st, setSt] = useState(null);
  const [offline, setOffline] = useState(false);
  const [logs, setLogs] = useState([]);
  const [nivel, setNivel] = useState('');
  const [busca, setBusca] = useState('');
  const [pausado, setPausado] = useState(false);
  const [saida, setSaida] = useState(null);
  const ultimo = useRef(0);
  const box = useRef(null);
  const colado = useRef(true);

  const loadStatus = useCallback(() => api('/sistema/status').then((r) => { setSt(r); setOffline(false); }).catch(() => setOffline(true)), []);
  useEffect(() => { loadStatus(); const t = setInterval(loadStatus, 10000); return () => clearInterval(t); }, [loadStatus]);

  // log ao vivo: busca só o que é novo a cada 2 s
  useEffect(() => {
    if (pausado) return undefined;
    let vivo = true;
    const tick = () => api(`/sistema/logs?desde=${ultimo.current}&limite=1000`).then((r) => {
      if (!vivo) return;
      if (r.ultimo < ultimo.current) { ultimo.current = 0; setLogs([]); return; } // servidor reiniciou
      if (r.itens.length) { ultimo.current = r.itens[r.itens.length - 1].id; setLogs((l) => [...l, ...r.itens].slice(-3000)); }
      setOffline(false);
    }).catch(() => vivo && setOffline(true));
    tick();
    const t = setInterval(tick, 2000);
    return () => { vivo = false; clearInterval(t); };
  }, [pausado]);
  useEffect(() => { if (colado.current && box.current) box.current.scrollTop = box.current.scrollHeight; }, [logs, nivel, busca]);

  const acao = async (url, msg) => {
    try {
      const r = await api(url, { method: 'POST' });
      if (r?.saida !== undefined) setSaida(r);
      toast(msg(r));
      setTimeout(loadStatus, 1500);
      return r;
    } catch (e) { toast(e.message, 'bad'); return null; }
  };
  const baixar = async () => {
    const r = await fetch('/api/sistema/logs/download', { headers: { Authorization: 'Bearer ' + getToken() } });
    const b = await r.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'servidor.log'; a.click();
  };

  const vis = logs.filter((l) => (!nivel || (nivel === 'aviso' ? l.nivel !== 'info' : l.nivel === 'erro')) && (!busca || l.msg.toLowerCase().includes(busca.toLowerCase())));
  const s = st?.servidor;
  return (
    <>
      {offline && <div className="sys-off"><i />Sem resposta do servidor — reiniciando ou fora do ar. Tentando de novo…</div>}
      <div className="sys-grid">
        <div className="panel sys-card">
          <small>Servidor</small>
          <b className={s ? 'ok' : ''}>{s ? 'No ar' : '—'}</b>
          {s && <span>há {fmtUp(s.uptime_s)} · {s.memoria_mb} MB · Node {s.node}</span>}
          {s && <span className="muted">{s.so} · {s.host} · PID {s.pid}</span>}
        </div>
        <div className="panel sys-card">
          <small>Banco de dados</small>
          <b className={st?.banco?.ok ? 'ok' : 'bad'}>{st ? (st.banco.ok ? 'OK' : 'Falha') : '—'}</b>
          <span>{st?.banco?.ok ? `responde em ${st.banco.ms} ms` : st?.banco?.erro}</span>
          <span className="muted">Captura {s?.captura ? 'ligada' : 'pausada'}</span>
        </div>
        {(st?.cameras || []).map((c) => (
          <div key={c.id} className="panel sys-card">
            <small>{c.codigo} · {c.url_base}</small>
            <b className={c.status?.estado === 'online' ? 'ok' : c.status?.estado === 'erro' ? 'bad' : 'warn'}>{c.status?.estado || (c.ativo ? 'sem status' : 'desativada')}</b>
            <span>Rede: {c.rede ? (c.rede.ok ? `porta responde em ${c.rede.ms} ms` : `sem acesso (${c.rede.erro})`) : '—'}</span>
            {c.status?.erro && <span className="bad-t">{c.status.erro}</span>}
            {c.status?.ultimoEvento && <span className="muted">último evento {ago(c.status.ultimoEvento)}</span>}
          </div>
        ))}
        <div className="panel sys-card">
          <small>VPN</small>
          <b className={st?.vpn?.status ? (st.vpn.status.ok ? 'ok' : 'bad') : ''}>{!st ? '—' : st.vpn.status ? (st.vpn.status.ok ? 'Ativa' : 'Com problema') : st.vpn.configurado ? 'Configurada' : 'Não configurada'}</b>
          <span className="muted mono-s">{st?.vpn?.status?.saida?.split('\n').slice(-2).join(' · ') || (st?.vpn?.configurado ? 'sem comando de status (VPN_STATUS_CMD)' : 'defina VPN_RESTART_CMD no server/.env')}</span>
        </div>
      </div>

      <div className="panel sys-acts">
        <Acao icon="plug" onRun={() => acao('/sistema/acoes/reconectar', () => 'Câmeras reconectando.')} title="Fecha e abre de novo a conexão de eventos e libera a pausa de senha">Reconectar câmeras</Acao>
        <Acao icon="pulse" onRun={() => acao('/sistema/acoes/testar-rede', (r) => r.map((x) => `${x.codigo}: ${x.ok ? `ok ${x.ms} ms` : x.erro}`).join(' · ') || 'Sem câmeras ativas.')} title="Testa se a porta da câmera responde pela rede/VPN, sem fazer login">Testar rede</Acao>
        <Acao icon="history" confirmar="Confirmar: reiniciar VPN?" disabled={!st?.acoes?.vpn} onRun={() => acao('/sistema/acoes/vpn', (r) => (r.ok ? `VPN reiniciada em ${(r.ms / 1000).toFixed(1)} s. Câmeras reconectam em seguida.` : 'O comando da VPN falhou — veja a saída abaixo.'))}
          title={st?.acoes?.vpn ? 'Roda o VPN_RESTART_CMD do server/.env' : 'Defina VPN_RESTART_CMD no server/.env'}>Reiniciar VPN</Acao>
        <Acao icon="out" confirmar="Confirmar: reiniciar servidor?" disabled={!st?.acoes?.reiniciar} onRun={() => acao('/sistema/acoes/reiniciar-servidor', () => 'Servidor reiniciando… a tela volta sozinha.')}
          title={st?.acoes?.reiniciar ? 'Reinicia o serviço da aplicação' : 'No Linux, com systemd: RESTART_BY_EXIT=1 no server/.env'}>Reiniciar servidor</Acao>
        <span className="muted sys-hint">{st && !st.acoes.reiniciar && 'Reiniciar servidor fica disponível quando a aplicação roda como serviço (Linux/systemd).'}</span>
      </div>
      {saida && (
        <div className="panel sys-out">
          <div className="panel-h">Saída do comando da VPN<span className="r"><span className={`badge ${saida.ok ? 'st-ok' : 'st-bad'}`}>{saida.ok ? 'ok' : `código ${saida.codigo}`}</span><button className="btn sm" onClick={() => setSaida(null)}>Fechar</button></span></div>
          <pre className="raw">{saida.saida || saida.erro || '(sem saída)'}</pre>
        </div>
      )}

      <div className="panel sys-log">
        <div className="panel-h">Log do servidor
          <span className="r">
            <div className="segtabs">
              {[['', 'Tudo'], ['aviso', 'Avisos e erros'], ['erro', 'Só erros']].map(([k, n]) => <button key={k} className={nivel === k ? 'on' : ''} onClick={() => setNivel(k)}>{n}</button>)}
            </div>
            <input className="sys-busca" placeholder="Filtrar texto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <button className={`btn sm ${pausado ? 'on' : ''}`} onClick={() => setPausado(!pausado)}>{pausado ? 'Continuar' : 'Pausar'}</button>
            <button className="btn sm" onClick={() => setLogs([])}>Limpar tela</button>
            <button className="btn sm" onClick={baixar}>Baixar log de hoje</button>
          </span>
        </div>
        <div ref={box} className="sys-lines" onScroll={(e) => { const el = e.currentTarget; colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30; }}>
          {vis.map((l) => (
            <div key={l.id} className={`ll ${l.nivel}`}><span className="lt">{new Date(l.ts).toLocaleTimeString('pt-BR')}</span><span className="lm">{l.msg}</span></div>
          ))}
          {!vis.length && <div className="ll muted">{logs.length ? 'Nada com esse filtro.' : 'Aguardando mensagens…'}</div>}
        </div>
      </div>
    </>
  );
}

export default function Diagnostico() {
  const { user } = useApp();
  const admin = user?.perfil === 'admin';
  const [tab, setTab] = useState(() => (admin ? localStorage.getItem('sv_diag_tab') || 'sistema' : 'integracao'));
  useEffect(() => { localStorage.setItem('sv_diag_tab', tab); }, [tab]);
  return (
    <>
      <Head crumb="Sistema" title="Diagnóstico">
        <div className="segtabs">
          {admin && <button className={tab === 'sistema' ? 'on' : ''} onClick={() => setTab('sistema')}>Sistema e log</button>}
          <button className={tab === 'integracao' ? 'on' : ''} onClick={() => setTab('integracao')}>Eventos da câmera</button>
        </div>
      </Head>
      {tab === 'sistema' && admin ? <Sistema /> : <Integracao />}
    </>
  );
}
