// Ao Vivo pela API da câmera: snapshots em sequência (padrão) ou MJPEG, e detecções chegando ao lado.
// (Vídeo RTSP → WebRTC fica para a fase 3, quando a porta 554 estiver acessível.)
import { useEffect, useRef, useState } from 'react';
import { api, getToken, media } from '../api.js';
import { bus, useApp } from '../App.jsx';
import { AN_ICON, AnBadge, Head, Icon, Plate, fmtT, groupOf } from '../ui.jsx';
import EventModal from '../components/EventModal.jsx';

export function LiveVideo({ cam }) {
  const [v, setV] = useState(null);
  useEffect(() => {
    setV(null);
    if (cam) api(`/cameras/${cam.id}/video`).then(setV).catch((e) => setV({ disponivel: false, motivo: e.message }));
  }, [cam?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return <div className="msg">Conectando ao vídeo…</div>;
  if (!v.disponivel) return (
    <div className="msg"><b>Vídeo RTSP indisponível</b>{v.motivo}<br /><small>Para vídeo: túnel da porta 554 da câmera + go2rtc rodando (veja README). Enquanto isso, use Snapshot ou MJPEG.</small></div>
  );
  return (
    <>
      <iframe title="Vídeo ao vivo" src={`${v.go2rtc_url}/stream.html?src=${encodeURIComponent(v.stream)}&mode=webrtc,mse`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} allow="autoplay; fullscreen" />
      <div className="ov bl"><span className="chip">Vídeo RTSP · go2rtc (WebRTC)</span></div>
    </>
  );
}

export function LiveImage({ cam, modo, fps }) {
  const camId = cam?.id; // reinicia só se trocar de câmera (o objeto muda a cada atualização da tela)
  const [src, setSrc] = useState('');
  const [erro, setErro] = useState('');
  const [stats, setStats] = useState({ ms: 0, fps: 0 });
  const urlRef = useRef('');

  useEffect(() => {
    setErro('');
    setSrc('');
    if (!camId) return undefined;
    if (modo === 'mjpeg') { setSrc(media(`/api/cameras/${camId}/mjpeg`) + `&t=${Date.now()}`); return () => setSrc(''); }
    let stop = false;
    let timer;
    let frames = 0;
    let t0 = performance.now();
    const tick = async () => {
      const start = performance.now();
      try {
        const r = await fetch(`/api/cameras/${camId}/snapshot`, { headers: { Authorization: 'Bearer ' + getToken() }, cache: 'no-store' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `Erro ${r.status}`);
        const blob = await r.blob();
        if (stop) return;
        const u = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = u;
        setSrc(u);
        setErro('');
        frames++;
        const el = performance.now() - t0;
        if (el > 2000) { setStats({ ms: Math.round(performance.now() - start), fps: (frames * 1000 / el).toFixed(1) }); frames = 0; t0 = performance.now(); }
        timer = setTimeout(tick, Math.max(0, 1000 / fps - (performance.now() - start)));
      } catch (e) {
        if (stop) return;
        setErro(e.message);
        timer = setTimeout(tick, 3000);
      }
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [camId, modo, fps]);

  return (
    <>
      {src && <img src={src} alt="Ao vivo" onError={() => modo === 'mjpeg' && setErro('A câmera não entregou MJPEG. Configure o substream em MJPEG ou use o modo Snapshot.')} />}
      {(erro || !src) && (
        <div className="msg" style={{ position: src ? 'absolute' : 'static', background: src ? 'rgba(0,0,0,.7)' : 'none', borderRadius: 6 }}>
          {erro ? <><b>Sem imagem da câmera</b>{erro}<br /><small>{/senha|bloque|suspens/i.test(erro) ? 'O sistema não faz login na câmera enquanto isso (para não piorar o bloqueio).' : 'Tentando de novo a cada 3 s.'}</small></> : 'Conectando…'}
        </div>
      )}
      <div className="ov bl"><span className="chip">{modo === 'mjpeg' ? 'MJPEG' : `Snapshot · ${stats.fps} fps · ${stats.ms} ms`}</span></div>
    </>
  );
}

/** Filtro das detecções: o que aparece na lista (Mostrar) e o que vira registro no banco (Gravar). */
function FiltroAnaliticos({ ans, hidden, setHidden, onGravar, admin, onClose }) {
  const toggle = (k) => { const s = new Set(hidden); s.has(k) ? s.delete(k) : s.add(k); setHidden(s); };
  const ref = useRef(null);
  useEffect(() => {
    const out = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest('[data-filtro]')) onClose(); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [onClose]);
  return (
    <div className="popover" ref={ref}>
      <div className="pop-h"><b>Analíticos recebidos</b><span className="muted">hoje</span></div>
      <div className="pop-cols"><span>Analítico</span><span>Mostrar</span>{admin && <span title="Desligado: o evento chega, mas não é gravado">Gravar</span>}</div>
      {ans.map((a) => {
        const g = groupOf(a.grupo);
        return (
          <div key={a.chave} className={`pop-row ${a.ativo ? '' : 'off'}`}>
            <span className="nm" style={{ color: g.c }}><Icon n={AN_ICON[a.chave]} /><span style={{ color: 'var(--text)' }}>{a.nome}</span><small className="muted">{a.hoje || 0}</small></span>
            <input type="checkbox" checked={!hidden.has(a.chave)} onChange={() => toggle(a.chave)} aria-label={`Mostrar ${a.nome}`} />
            {admin && <span className={`toggle ${a.ativo ? 'on' : ''}`} onClick={() => onGravar(a)} role="switch" aria-checked={!!a.ativo} aria-label={`Gravar ${a.nome}`}><span className="sw" /></span>}
          </div>
        );
      })}
      <div className="pop-f">
        <button className="btn sm" onClick={() => setHidden(new Set())}>Mostrar todos</button>
        <button className="btn sm" onClick={() => setHidden(new Set(['anpr']))}>Esconder ANPR</button>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}

export default function AoVivo() {
  const [cams, setCams] = useState([]);
  const [status, setStatus] = useState({});
  const [sel, setSel] = useState(() => Number(localStorage.getItem('sv_cam')) || null);
  const [modo, setModo] = useState(() => localStorage.getItem('sv_modo') || 'snapshot');
  useEffect(() => { localStorage.setItem('sv_modo', modo); }, [modo]);
  const [fps, setFps] = useState(2);
  const [feed, setFeed] = useState([]);
  const [newIds, setNewIds] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [now, setNow] = useState(new Date());
  const [captura, setCaptura] = useState(true);
  const { user, toast } = useApp();
  const [ans, setAns] = useState([]);
  const [hidden, setHiddenState] = useState(() => new Set(JSON.parse(localStorage.getItem('sv_feed_hidden') || '["anpr"]')));
  const [showFiltro, setShowFiltro] = useState(false);
  const setHidden = (s) => { setHiddenState(s); localStorage.setItem('sv_feed_hidden', JSON.stringify([...s])); };
  const loadAns = () => api('/analiticos').then((l) => setAns(l.sort((a, b) => (b.hoje || 0) - (a.hoje || 0))));
  useEffect(() => { loadAns(); }, []);
  const gravar = async (a) => {
    try {
      await api(`/analiticos/${a.chave}`, { method: 'PUT', body: { ativo: !a.ativo } });
      toast(`${a.nome}: ${a.ativo ? 'não será mais gravado' : 'volta a ser gravado'}.`);
      loadAns();
    } catch (e) { toast(e.message, 'bad'); }
  };
  useEffect(() => {
    api('/captura').then((r) => setCaptura(r.ativa));
    const on = (e) => setCaptura(e.detail.ativa);
    bus.addEventListener('captura', on);
    return () => bus.removeEventListener('captura', on);
  }, []);
  const toggleCaptura = () => api('/captura', { method: 'POST', body: { ativa: !captura } }).then((r) => setCaptura(r.ativa));

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    Promise.all([api('/cameras'), api('/cameras/status')]).then(([c, s]) => {
      setCams(c.filter((x) => x.ativo));
      setStatus(s);
      setSel((cur) => (c.find((x) => x.id === cur) ? cur : c[0]?.id || null));
    });
    const onEv = (e) => {
      setAns((l) => l.map((a) => (a.chave === e.detail.evento.chave ? { ...a, hoje: (a.hoje || 0) + 1 } : a)));
      const ev = e.detail.evento;
      setFeed((f) => [ev, ...f.filter((x) => x.id !== ev.id)].slice(0, 80));
      setNewIds((s) => new Set(s).add(ev.id));
    };
    const onUpd = (e) => setFeed((f) => f.map((x) => (x.id === e.detail.evento.id ? e.detail.evento : x)));
    const onSt = (e) => setStatus((s) => ({ ...s, [e.detail.camera_id]: e.detail.status }));
    bus.addEventListener('evento', onEv);
    bus.addEventListener('evento_atualizado', onUpd);
    bus.addEventListener('camera_status', onSt);
    return () => { bus.removeEventListener('evento', onEv); bus.removeEventListener('evento_atualizado', onUpd); bus.removeEventListener('camera_status', onSt); };
  }, []);
  useEffect(() => { if (sel) localStorage.setItem('sv_cam', sel); }, [sel]);
  // lista inicial já sem os analíticos escondidos (senão o ANPR ocupa tudo)
  useEffect(() => {
    const ex = [...hidden].join(',');
    api(`/eventos?size=40${ex ? `&excluir=${ex}` : ''}`).then((r) => setFeed(r.items));
  }, [hidden]);
  const visivel = feed.filter((e) => !hidden.has(e.chave));

  const cam = cams.find((c) => c.id === sel);
  const st = cam ? status[cam.id] : null;
  const thumbOf = (e) => e.imagens?.[0]?.url;

  return (
    <>
      <Head crumb="Monitoramento" title="Vídeo Ao Vivo">
        <span className={`toggle ${captura ? 'on' : ''}`} onClick={toggleCaptura} role="switch" aria-checked={captura}
          title={captura ? 'Eventos da câmera estão sendo gravados como registros' : 'Ao vivo continua, mas nenhum evento é gravado'}>
          <span className="sw" />{captura ? 'Captura de eventos ligada' : 'Captura pausada'}
        </span>
        <span style={{ width: 8 }} />
        <div className="segtabs">
          <button className={modo === 'snapshot' ? 'on' : ''} onClick={() => setModo('snapshot')}>Snapshot</button>
          <button className={modo === 'mjpeg' ? 'on' : ''} onClick={() => setModo('mjpeg')}>MJPEG</button>
          <button className={modo === 'video' ? 'on' : ''} onClick={() => setModo('video')} title="RTSP via go2rtc">Vídeo</button>
        </div>
        {modo === 'snapshot' && (
          <select className="btn" value={fps} onChange={(e) => setFps(Number(e.target.value))} title="Quadros por segundo">
            {[1, 2, 4, 8].map((f) => <option key={f} value={f}>{f} fps</option>)}
          </select>
        )}
      </Head>
      {!cams.length ? <div className="panel empty">Nenhuma câmera ativa. Cadastre em Câmeras.</div> : (
        <div className="live-grid">
          <div className="viewer">
            <div className="video">
              {modo === 'video' ? <LiveVideo cam={cam} /> : <LiveImage cam={cam} modo={modo} fps={fps} />}
              <div className="ov tl"><span className={`live-dot ${st?.estado === 'online' ? '' : 'off'}`}><i />AO VIVO</span><span className="chip">{cam?.codigo} · {cam?.nome}</span></div>
              <div className="ov tr"><span className="chip mono">{now.toLocaleString('pt-BR').replace(',', '')}</span></div>
              <div className="ov br"><span className="chip">Eventos: {st?.estado || '—'}{st?.erro ? ` · ${st.erro}` : ''}</span></div>
            </div>
            <div className="thumbs">
              {cams.map((c) => {
                const s = status[c.id]?.estado;
                return (
                  <button key={c.id} className={`thumb ${c.id === sel ? 'on' : ''}`} onClick={() => setSel(c.id)} title={`${c.nome} · eventos: ${s || '—'}`}
                    style={{ backgroundImage: `url(${media(`/api/cameras/${c.id}/snapshot`)}&th=${Math.floor(Date.now() / 30000)})` }}>
                    <span className={`s ${s === 'online' ? '' : s === 'conectando' ? 'warn' : 'bad'}`} /><span className="n">{c.codigo}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="panel feed">
            <div className="panel-h" style={{ position: 'relative' }}>Últimas detecções
              <span className="r"><button className="btn sm" data-filtro onClick={() => setShowFiltro(!showFiltro)} title="Escolher quais analíticos aparecem">
                Analíticos{hidden.size ? ` · ${hidden.size} oculto${hidden.size > 1 ? 's' : ''}` : ''}<Icon n="down" style={{ width: 12, height: 12 }} /></button></span>
              {showFiltro && <FiltroAnaliticos ans={ans} hidden={hidden} setHidden={setHidden} onGravar={gravar} admin={user.perfil === 'admin'} onClose={() => setShowFiltro(false)} />}
            </div>
            <div className="list">
              {!captura && <div className="empty" style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>Captura pausada: o ao vivo continua, mas nenhum evento novo é gravado.</div>}
              {!visivel.length && captura && <div className="empty">Aguardando detecções{hidden.size ? ' (alguns analíticos estão ocultos)' : ' da câmera'}…</div>}
              {visivel.map((e) => (
                <button key={e.id} className={`fi ${newIds.has(e.id) ? 'new' : ''}`} onClick={() => setOpen(e.id)}>
                  <div className="im" style={{ backgroundImage: thumbOf(e) ? `url(${media(thumbOf(e))})` : 'none' }} />
                  <div className="t">
                    <AnBadge chave={e.chave} nome={e.analitico_nome} grupo={e.analitico_grupo} />
                    <div className="pl-row"><Plate p={e.placa} />{e.velocidade != null && <small>{e.velocidade} km/h</small>}</div>
                    <small>{e.camera_codigo} · {fmtT(e.ocorrido_em)}</small>
                    {e.status_validacao === 'validado'
                      ? <span className="vmini ok"><Icon n="check" />{e.validado_por_usuario}</span>
                      : <span className="vmini">Aguardando validação</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {open && <EventModal id={open} ids={visivel.map((x) => x.id)} onClose={() => setOpen(null)}
        onChange={(ev) => setFeed((f) => f.map((x) => (x.id === ev.id ? ev : x)))} />}
    </>
  );
}
