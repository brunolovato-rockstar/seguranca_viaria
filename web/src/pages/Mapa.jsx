// Mapa das câmeras (Mapbox): status, detecções do dia e últimos registros de cada ponto.
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api, media } from '../api.js';
import { bus, useApp } from '../App.jsx';
import { AN_ICON, AnBadge, Head, Icon, Plate, fmtT, groupOf } from '../ui.jsx';
import { LiveImage } from './AoVivo.jsx';
import EventModal from '../components/EventModal.jsx';

const ESTILOS = {
  mapa: { day: 'mapbox://styles/mapbox/streets-v12', night: 'mapbox://styles/mapbox/navigation-night-v1' },
  cinza: { day: 'mapbox://styles/mapbox/light-v11', night: 'mapbox://styles/mapbox/dark-v11' },
  satelite: { day: 'mapbox://styles/mapbox/satellite-streets-v12', night: 'mapbox://styles/mapbox/satellite-streets-v12' },
};
const OK = ['online', 'aguardando push', 'captura pausada', 'eventos desligados'];
const estadoDe = (c) => {
  if (!c.ativo) return { k: 'off', t: 'Desativada' };
  const e = c.status?.estado;
  if (e === 'online') return { k: 'ok', t: 'Online' };
  if (OK.includes(e)) return { k: 'warn', t: e[0].toUpperCase() + e.slice(1) };
  return { k: 'bad', t: e ? (e === 'erro' ? 'Sem conexão' : e) : 'Sem status' };
};
// 3D: prédios em volume + relevo, com a câmera inclinada
function aplica3D(m, on, mode, animar) {
  if (!m.isStyleLoaded()) return;
  const temPredios = !!m.getSource('composite');
  if (on) {
    if (!m.getSource('sv-dem')) m.addSource('sv-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
    m.setTerrain({ source: 'sv-dem', exaggeration: 1.2 });
    if (temPredios && !m.getLayer('sv-predios')) {
      const rotulo = m.getStyle().layers.find((l) => l.type === 'symbol' && l.layout?.['text-field'])?.id;
      m.addLayer({
        id: 'sv-predios', source: 'composite', 'source-layer': 'building', filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 14,
        paint: {
          'fill-extrusion-color': mode === 'night' ? '#2b3138' : '#d5dae0',
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.5, ['get', 'height']],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.5, ['get', 'min_height']],
          'fill-extrusion-opacity': 0.85,
        },
      }, rotulo);
    }
    if (animar) m.easeTo({ pitch: 60, bearing: -20, zoom: Math.max(m.getZoom(), 16), duration: 900 });
  } else {
    if (m.getLayer('sv-predios')) m.removeLayer('sv-predios');
    m.setTerrain(null);
    if (animar) m.easeTo({ pitch: 0, bearing: 0, duration: 700 });
  }
}

const temLocal = (c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude);

function markerEl(c) {
  const el = document.createElement('div');
  el.className = 'mk';
  el.innerHTML = `<div class="mk-pin"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="14" height="10" rx="2"/><path d="M16 11l6-3v8l-6-3"/></svg><b class="mk-n"></b></div><span class="mk-lb"></span>`;
  return el;
}
function paintMarker(el, c, sel) {
  const st = estadoDe(c);
  el.className = `mk mk--${st.k} ${sel ? 'sel' : ''}`; // não usar st-*: é classe global com fundo
  el.querySelector('.mk-lb').textContent = c.codigo;
  const n = el.querySelector('.mk-n');
  n.textContent = c.hoje.total > 999 ? '999+' : String(c.hoje.total || '');
  n.style.display = c.hoje.total ? '' : 'none';
  el.title = `${c.codigo} · ${c.nome} — ${st.t}`;
}


const lerLS = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? def; } catch { return def; } };

/** Escolha de quais analíticos viram contador sobre o mapa. */
function FiltroContadores({ ans, sel, setSel, visivel, setVisivel, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const out = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest('[data-cont]')) onClose(); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [onClose]);
  const toggle = (k) => setSel(sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k]);
  return (
    <div className="popover mc-pop" ref={ref}>
      <div className="pop-h"><b>Contadores no mapa</b><label className="mc-sw"><input type="checkbox" checked={visivel} onChange={(e) => setVisivel(e.target.checked)} />Mostrar</label></div>
      <div className="msel-list">
        {ans.map((a) => (
          <label key={a.chave} className="msel-row" style={{ gridTemplateColumns: '16px 16px 1fr auto' }}>
            <input type="checkbox" checked={sel.includes(a.chave)} onChange={() => toggle(a.chave)} />
            <Icon n={AN_ICON[a.chave]} style={{ color: groupOf(a.grupo).c }} />
            <span className="nm">{a.nome}</span>
            <small className="muted">{a.hoje || 0}</small>
          </label>
        ))}
      </div>
      <div className="pop-f">
        <button className="btn sm" onClick={() => setSel(ans.filter((a) => a.destaque).map((a) => a.chave))}>Destaques</button>
        <button className="btn sm" onClick={() => setSel(ans.filter((a) => a.hoje > 0).map((a) => a.chave))}>Com registro hoje</button>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}

/** Um contador do dia sobre o mapa; pisca quando o número sobe. */
function Contador({ a, n }) {
  const [bump, setBump] = useState(false);
  const prev = useRef(n);
  useEffect(() => {
    if (n > prev.current) { setBump(true); const t = setTimeout(() => setBump(false), 900); prev.current = n; return () => clearTimeout(t); }
    prev.current = n;
    return undefined;
  }, [n]);
  const g = groupOf(a.grupo);
  return (
    <div className={`mc ${bump ? 'bump' : ''}`} style={{ '--gc': g.c }} title={`${a.nome} — hoje`}>
      <span className="mc-ic"><Icon n={AN_ICON[a.chave]} /></span>
      <span className="mc-t"><small>{a.nome}</small><b>{Number(n).toLocaleString('pt-BR')}</b></span>
    </div>
  );
}

/** Janela de vídeo que o usuário arrasta e redimensiona sobre o mapa. */
function VideoFlutuante({ cam, cams, setCamId, area, onClose }) {
  const [pos, setPos] = useState(() => lerLS('sv_map_vid', { x: 16, y: null, w: 360, h: 230 }));
  const [modo, setModo] = useState('snapshot');
  const box = useRef(null);
  const drag = useRef(null);
  useEffect(() => { localStorage.setItem('sv_map_vid', JSON.stringify(pos)); }, [pos]);
  // guarda o tamanho quando o usuário redimensiona pelo canto
  useEffect(() => {
    if (!box.current) return undefined;
    const ro = new ResizeObserver(() => {
      const el = box.current; if (!el) return;
      setPos((p) => (Math.abs(p.w - el.offsetWidth) > 2 || Math.abs(p.h - el.offsetHeight) > 2 ? { ...p, w: el.offsetWidth, h: el.offsetHeight } : p));
    });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const limites = (x, y) => {
    const A = area.current?.getBoundingClientRect();
    if (!A) return { x, y };
    return { x: Math.min(Math.max(0, x), A.width - 80), y: Math.min(Math.max(0, y), A.height - 34) };
  };
  const down = (e) => {
    if (e.target.closest('button,select')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = box.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
  };
  const move = (e) => {
    if (!drag.current) return;
    const A = area.current.getBoundingClientRect();
    setPos((p) => ({ ...p, ...limites(e.clientX - A.left - drag.current.dx, e.clientY - A.top - drag.current.dy) }));
  };
  const up = () => { drag.current = null; };
  const A = area.current?.getBoundingClientRect();
  const y = pos.y ?? Math.max(0, (A?.height || 600) - pos.h - 40);
  return (
    <div ref={box} className="mv" style={{ left: pos.x, top: y, width: pos.w, height: pos.h }}>
      <div className="mv-h" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="Arraste para mover">
        <span className="live-dot"><i />AO VIVO</span>
        <select value={cam?.id || ''} onChange={(e) => setCamId(Number(e.target.value))}>
          {cams.map((c) => <option key={c.id} value={c.id}>{c.codigo}</option>)}
        </select>
        <button className={modo === 'snapshot' ? 'on' : ''} onClick={() => setModo('snapshot')}>Snapshot</button>
        <button className={modo === 'mjpeg' ? 'on' : ''} onClick={() => setModo('mjpeg')}>MJPEG</button>
        <button className="mv-x" onClick={onClose} title="Fechar vídeo" aria-label="Fechar vídeo">✕</button>
      </div>
      <div className="video mv-v">{cam ? <LiveImage cam={cam} modo={modo} fps={2} /> : <div className="msg">Nenhuma câmera.</div>}</div>
    </div>
  );
}

export default function Mapa() {
  const { mode } = useApp();
  const nav = useNavigate();
  const box = useRef(null);
  const map = useRef(null);
  const marks = useRef(new Map());
  const estiloAtual = useRef(null);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [sel, setSel] = useState(null);
  const [camada, setCamada] = useState(() => localStorage.getItem('sv_map_camada') || 'mapa');
  const [tres, setTres] = useState(() => localStorage.getItem('sv_map_3d') === '1');
  const tresRef = useRef(tres);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [ultimos, setUltimos] = useState([]);
  const [open, setOpen] = useState(null);
  const area = useRef(null);
  const [ans, setAns] = useState([]);
  const [contSel, setContSel] = useState(() => lerLS('sv_map_cont', null));
  const [contVis, setContVis] = useState(() => lerLS('sv_map_cont_vis', true));
  const [showFiltro, setShowFiltro] = useState(false);
  const [video, setVideo] = useState(() => lerLS('sv_map_video', false));
  const [vidCamId, setVidCamId] = useState(null);
  useEffect(() => { api('/analiticos').then(setAns).catch(() => {}); }, [dados]);
  useEffect(() => { if (contSel) localStorage.setItem('sv_map_cont', JSON.stringify(contSel)); }, [contSel]);
  useEffect(() => { localStorage.setItem('sv_map_cont_vis', JSON.stringify(contVis)); }, [contVis]);
  useEffect(() => { localStorage.setItem('sv_map_video', JSON.stringify(video)); }, [video]);

  const load = useCallback(() => api('/mapa').then(setDados).catch((e) => setErro(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(load, 1500); };
    bus.addEventListener('evento', later);
    bus.addEventListener('camera_status', later);
    return () => { clearTimeout(t); bus.removeEventListener('evento', later); bus.removeEventListener('camera_status', later); };
  }, [load]);

  const cams = dados?.cameras || [];
  const noMapa = cams.filter(temLocal);
  const atual = cams.find((c) => c.id === sel) || null;
  // contadores do dia: da câmera selecionada ou de todas
  const selecionados = contSel ?? ans.filter((a) => a.destaque).map((a) => a.chave);
  const contagem = useMemo(() => {
    const m = {};
    for (const c of (atual ? [atual] : cams)) for (const a of c.hoje.analiticos) m[a.chave] = (m[a.chave] || 0) + a.n;
    return m;
  }, [atual, cams]);
  const camVideo = cams.find((c) => c.id === (vidCamId ?? atual?.id)) || cams.find(temLocal) || cams[0] || null;

  // cria o mapa quando a chave chega
  useEffect(() => {
    if (!dados?.token || map.current || !box.current) return;
    mapboxgl.accessToken = dados.token;
    const pts = dados.cameras.filter(temLocal);
    const m = new mapboxgl.Map({
      container: box.current,
      style: dados.estilo || ESTILOS[camada][mode] || ESTILOS.mapa.day,
      center: pts.length ? [pts[0].longitude, pts[0].latitude] : [-49.27, -25.43],
      zoom: pts.length ? (tres ? 16.5 : 15) : 9,
      pitch: tres ? 60 : 0,
      bearing: tres ? -20 : 0,
      attributionControl: true,
      cooperativeGestures: false,
    });
    m.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
    m.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.addControl(new mapboxgl.FullscreenControl(), 'top-right');
    if (pts.length > 1) {
      const b = new mapboxgl.LngLatBounds();
      pts.forEach((c) => b.extend([c.longitude, c.latitude]));
      m.fitBounds(b, { padding: 80, maxZoom: 15, duration: 0 });
    }
    // a cada troca de estilo (mapa/cinza/satélite, dia/noite) o 3D precisa ser recolocado
    m.on('style.load', () => aplica3D(m, tresRef.current, modeRef.current, false));
    map.current = m;
    estiloAtual.current = dados.estilo || ESTILOS[camada][mode];
    return () => { m.remove(); map.current = null; marks.current.clear(); };
  }, [dados?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // estilo: dia/noite e mapa/satélite
  useEffect(() => {
    localStorage.setItem('sv_map_camada', camada);
    const url = ESTILOS[camada][mode];
    if (map.current && !dados?.estilo && estiloAtual.current !== url) { map.current.setStyle(url); estiloAtual.current = url; }
  }, [camada, mode, dados?.estilo]);

  useEffect(() => {
    tresRef.current = tres;
    localStorage.setItem('sv_map_3d', tres ? '1' : '0');
    if (map.current) aplica3D(map.current, tres, mode, true);
  }, [tres]); // eslint-disable-line react-hooks/exhaustive-deps

  // marcadores
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const vivos = new Set();
    for (const c of noMapa) {
      vivos.add(c.id);
      let mk = marks.current.get(c.id);
      if (!mk) {
        const el = markerEl(c);
        el.addEventListener('click', (e) => { e.stopPropagation(); setSel(c.id); });
        mk = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([c.longitude, c.latitude]).addTo(m);
        marks.current.set(c.id, mk);
      }
      mk.setLngLat([c.longitude, c.latitude]);
      paintMarker(mk.getElement(), c, c.id === sel);
    }
    for (const [id, mk] of marks.current) if (!vivos.has(id)) { mk.remove(); marks.current.delete(id); }
  }, [noMapa, sel]);

  // pulso no marcador quando chega detecção
  useEffect(() => {
    const on = (e) => {
      const mk = marks.current.get(e.detail?.evento?.camera_id ?? e.detail?.camera_id);
      if (!mk) return;
      const el = mk.getElement();
      el.classList.remove('ping'); void el.offsetWidth; el.classList.add('ping');
    };
    bus.addEventListener('evento', on);
    return () => bus.removeEventListener('evento', on);
  }, []);

  // seleção: voa até a câmera e carrega os últimos registros
  useEffect(() => {
    if (!atual) { setUltimos([]); return; }
    if (temLocal(atual) && map.current) map.current.flyTo({ center: [atual.longitude, atual.latitude], zoom: Math.max(map.current.getZoom(), 16), speed: 1.4, ...(tresRef.current ? { pitch: 60 } : {}) });
    api(`/eventos?camera=${atual.id}&size=8&excluir=anpr`).then((r) => setUltimos(r.items)).catch(() => setUltimos([]));
  }, [sel, atual?.hoje.total]); // eslint-disable-line react-hooks/exhaustive-deps

  const aoVivo = (c) => { localStorage.setItem('sv_cam', c.id); nav('/ao-vivo'); };
  const registros = (c) => nav(`/registros?camera=${c.id}`);

  return (
    <>
      <Head crumb="Monitoramento" title="Mapa">
        <div className="segtabs">
          <button className={camada === 'mapa' ? 'on' : ''} onClick={() => setCamada('mapa')}>Mapa</button>
          <button className={camada === 'cinza' ? 'on' : ''} onClick={() => setCamada('cinza')}>Cinza</button>
          <button className={camada === 'satelite' ? 'on' : ''} onClick={() => setCamada('satelite')}>Satélite</button>
        </div>
        <div className="mc-wrap">
          <button className={`btn ${contVis ? 'on' : ''}`} data-cont onClick={() => setShowFiltro(!showFiltro)}><Icon n="chart" />Contadores<Icon n="down" style={{ width: 12, height: 12 }} /></button>
          {showFiltro && <FiltroContadores ans={ans} sel={selecionados} setSel={setContSel} visivel={contVis} setVisivel={setContVis} onClose={() => setShowFiltro(false)} />}
        </div>
        <button className={`btn ${video ? 'on' : ''}`} onClick={() => setVideo(!video)}><Icon n="live" />Vídeo</button>
        <div className="segtabs">
          <button className={tres ? 'on' : ''} onClick={() => setTres(!tres)} title="Prédios em 3D e relevo, com o mapa inclinado">3D</button>
        </div>
      </Head>
      <div className="map-grid">
        <div className="panel map-panel">
          {!dados ? <div className="empty">{erro || 'Carregando…'}</div> : !dados.token ? (
            <div className="map-empty">
              <Icon n="map" />
              <b>Mapa sem chave do Mapbox</b>
              <p>Coloque a chave pública (começa com <span className="mono">pk.</span>) no arquivo <span className="mono">server/.env</span>:</p>
              <pre>MAPBOX_TOKEN=pk.xxxxxxxx</pre>
              <p className="muted">Depois reinicie o servidor (npm run dev).</p>
            </div>
          ) : <div ref={box} className="map-box" />}
          <div ref={area} className="map-ov">
            {contVis && selecionados.length > 0 && dados?.token && (
              <div className="mc-strip">
                <div className="mc-scope">{atual ? `${atual.codigo}` : 'Todas as câmeras'} · hoje</div>
                {ans.filter((a) => selecionados.includes(a.chave)).map((a) => <Contador key={a.chave} a={a} n={contagem[a.chave] || 0} />)}
              </div>
            )}
            {video && dados?.token && <VideoFlutuante cam={camVideo} cams={cams} setCamId={setVidCamId} area={area} onClose={() => setVideo(false)} />}
          </div>
        </div>

        <div className="panel map-side">
          {!atual ? (
            <>
              <div className="panel-h">Câmeras<span className="r muted">{noMapa.length} de {cams.length} no mapa</span></div>
              <div className="ms-list">
                {cams.map((c) => {
                  const st = estadoDe(c);
                  return (
                    <button key={c.id} className="ms-cam" onClick={() => setSel(c.id)}>
                      <i className={`dot ${st.k}`} />
                      <span className="ms-t"><b>{c.codigo} · {c.nome}</b>
                        <small>{[c.rodovia, c.km != null && `km ${String(c.km).replace('.', ',')}`].filter(Boolean).join(' · ') || '—'}{!temLocal(c) && <em> · sem localização</em>}</small></span>
                      <span className="ms-n"><b>{c.hoje.total}</b><small>hoje</small></span>
                    </button>
                  );
                })}
                {!cams.length && <div className="empty">Nenhuma câmera cadastrada.</div>}
              </div>
            </>
          ) : (
            <>
              <div className="panel-h">
                <button className="btn icon sm" onClick={() => setSel(null)} title="Voltar à lista"><Icon n="chevL" /></button>
                {atual.codigo}
                <span className={`badge st-${estadoDe(atual).k === 'off' ? 'mute' : estadoDe(atual).k}`} style={{ marginLeft: 'auto' }}>{estadoDe(atual).t}</span>
              </div>
              <div className="ms-body">
                <div className="ms-head">
                  <b>{atual.nome}</b>
                  <small>{[atual.rodovia, atual.km != null && `km ${String(atual.km).replace('.', ',')}`, atual.pista].filter(Boolean).join(' · ') || 'Local não informado'}</small>
                  {temLocal(atual)
                    ? <small className="mono muted">{atual.latitude.toFixed(6)}, {atual.longitude.toFixed(6)}</small>
                    : <small className="ms-warn">Sem latitude/longitude — informe em Câmeras para aparecer no mapa.</small>}
                </div>
                <div className="ms-kpis">
                  <div><small>Detecções hoje</small><b>{atual.hoje.total}</b></div>
                  <div><small>Aguardando validação</small><b>{atual.hoje.aguardando}</b></div>
                  <div><small>Última</small><b>{atual.hoje.ultimo ? fmtT(atual.hoje.ultimo) : '—'}</b></div>
                </div>
                <div className="ms-actions">
                  <button className="btn" onClick={() => aoVivo(atual)}><Icon n="live" />Ao vivo</button>
                  <button className="btn" onClick={() => registros(atual)}><Icon n="records" />Registros</button>
                </div>
                <h6 className="ms-h">Analíticos hoje</h6>
                {atual.hoje.analiticos.length ? (
                  <div className="ms-ans">
                    {atual.hoje.analiticos.map((a) => (
                      <div key={a.chave || '-'}><AnBadge chave={a.chave} nome={a.nome} grupo={a.grupo} /><b>{a.n}</b></div>
                    ))}
                  </div>
                ) : <p className="muted ms-p">Nenhuma detecção hoje.</p>}
                <h6 className="ms-h">Últimas infrações<span className="muted"> (sem ANPR)</span></h6>
                <div className="ms-evs">
                  {ultimos.map((e) => (
                    <button key={e.id} className="ms-ev" onClick={() => setOpen(e.id)}>
                      {e.imagens?.[0] ? <img src={media(e.imagens[0].url)} alt="" loading="lazy" /> : <span className="noimg" />}
                      <span className="ms-ev-t"><AnBadge chave={e.chave} nome={e.analitico_nome} grupo={e.analitico_grupo} /><small>{fmtT(e.ocorrido_em)} · #{e.id}</small></span>
                      {e.placa && <Plate p={e.placa} />}
                    </button>
                  ))}
                  {!ultimos.length && <p className="muted ms-p">Sem registros.</p>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {open && <EventModal id={open} ids={ultimos.map((e) => e.id)} onClose={() => setOpen(null)} />}
    </>
  );
}
