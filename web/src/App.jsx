import { createContext, useContext, useEffect, useMemo, useState, useCallback, lazy, Suspense } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, connectWs, getToken, setToken } from './api.js';
import { Icon } from './ui.jsx';
import logoWhite from './assets/logo_allwhite.png';
import Login from './pages/Login.jsx';
import AoVivo from './pages/AoVivo.jsx';
import Registros from './pages/Registros.jsx';
import Cameras from './pages/Cameras.jsx';
import Analiticos from './pages/Analiticos.jsx';
import Diagnostico from './pages/Diagnostico.jsx';
import LogAcesso from './pages/LogAcesso.jsx';
import Usuarios from './pages/Usuarios.jsx';

const Mapa = lazy(() => import('./pages/Mapa.jsx')); // Mapbox só carrega ao abrir o mapa
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// Barramento simples para as mensagens do WebSocket
export const bus = new EventTarget();

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(!!getToken());
  const [toasts, setToasts] = useState([]);
  const [mode, setMode] = useState(() => localStorage.getItem('sv_mode') || 'day');

  useEffect(() => { document.documentElement.dataset.mode = mode; localStorage.setItem('sv_mode', mode); }, [mode]);

  const toast = useCallback((msg, kind) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me').then((r) => setUser(r.usuario)).catch(() => setToken(null)).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('sv-logout', out);
    return () => window.removeEventListener('sv-logout', out);
  }, []);
  useEffect(() => {
    if (!user) return;
    return connectWs((m) => bus.dispatchEvent(new CustomEvent(m.type, { detail: m })));
  }, [user]);

  const ctx = useMemo(() => ({ user, setUser, toast, mode, setMode }), [user, toast, mode]);
  if (checking) return null;
  return (
    <Ctx.Provider value={ctx}>
      {user ? <Shell /> : <Login />}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind || ''}`}>{t.msg}</div>)}</div>
    </Ctx.Provider>
  );
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <div className="clock">{now.toLocaleString('pt-BR').replace(',', '')}</div>;
}

function Shell() {
  const { user, setUser, mode, setMode } = useApp();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sv_side') === '1');
  const [menu, setMenu] = useState(false);
  const [cams, setCams] = useState({ total: 0, online: 0 });
  const nav = useNavigate();

  useEffect(() => { localStorage.setItem('sv_side', collapsed ? '1' : '0'); }, [collapsed]);
  useEffect(() => {
    const load = () => Promise.all([api('/cameras'), api('/cameras/status')]).then(([list, st]) => {
      const ativos = list.filter((c) => c.ativo);
      setCams({ total: ativos.length, online: ativos.filter((c) => ['online', 'aguardando push', 'captura pausada', 'eventos desligados'].includes(st[c.id]?.estado)).length });
    }).catch(() => {});
    load();
    const on = () => load();
    bus.addEventListener('camera_status', on);
    const t = setInterval(load, 30000);
    return () => { bus.removeEventListener('camera_status', on); clearInterval(t); };
  }, []);

  const sair = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ok */ }
    setToken(null);
    setUser(null);
  };
  const off = cams.total - cams.online;
  const L = ({ to, icon, children }) => <NavLink to={to}><Icon n={icon} /><span>{children}</span></NavLink>;

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <header className="top">
        <div className="brand" role="button" tabIndex={0} title="Recolher / expandir menu" onClick={() => setCollapsed(!collapsed)}>
          <img src={logoWhite} alt="Pumatronix" />
        </div>
        <div className="tb-title">Segurança Viária</div>
        <span className="tb-sep" />
        <div className="tb-item"><span className="k">Câmeras</span><span className="v">{cams.online} de {cams.total} online</span>{off > 0 && <span className="tb-warn">· {off} offline</span>}</div>
        <div className="tb-spacer" />
        <div className={`tb-st hide-md ${off ? 'bad' : ''}`}><i />{off ? 'Atenção: câmera sem conexão' : 'Operação normal'}</div>
        <span className="tb-sep hide-md" />
        <Clock />
        <span className="tb-sep" />
        <button className="tb-btn" title={mode === 'night' ? 'Modo dia' : 'Modo noite'} onClick={() => setMode(mode === 'night' ? 'day' : 'night')}><Icon n={mode === 'night' ? 'sun' : 'moon'} /></button>
        <button className="tb-user" onClick={() => setMenu(!menu)}><Icon n="user" />{user.usuario}<Icon n="down" style={{ width: 12, height: 12 }} /></button>
        {menu && (
          <div className="umenu" onMouseLeave={() => setMenu(false)}>
            <div className="who"><b>{user.nome}</b><small>{user.perfil === 'admin' ? 'Administrador' : 'Operador'}</small></div>
            <button onClick={() => { setMenu(false); nav('/log-acesso'); }}><Icon n="log" />Log de acesso</button>
            <button onClick={sair}><Icon n="out" />Sair</button>
          </div>
        )}
      </header>
      <nav className="side">
        <h6>Monitoramento</h6>
        <L to="/dashboard" icon="chart">Dashboard</L>
        <L to="/ao-vivo" icon="live">Vídeo Ao Vivo</L>
        <L to="/registros" icon="records">Registros</L>
        <L to="/mapa" icon="map">Mapa</L>
        <h6>Dispositivos</h6>
        <L to="/cameras" icon="camera">Câmeras</L>
        <L to="/analiticos" icon="ai">Analíticos de IA</L>
        <h6>Sistema</h6>
        <L to="/diagnostico" icon="pulse">Diagnóstico</L>
        <L to="/log-acesso" icon="log">Log de Acesso</L>
        {user.perfil === 'admin' && <L to="/usuarios" icon="users">Usuários</L>}
      </nav>
      <main>
        <Routes>
          <Route path="/ao-vivo" element={<AoVivo />} />
          <Route path="/registros" element={<Registros />} />
          <Route path="/dashboard" element={<Suspense fallback={<div className="empty">Carregando…</div>}><Dashboard /></Suspense>} />
          <Route path="/mapa" element={<Suspense fallback={<div className="empty">Carregando mapa…</div>}><Mapa /></Suspense>} />
          <Route path="/cameras" element={<Cameras />} />
          <Route path="/analiticos" element={<Analiticos />} />
          <Route path="/diagnostico" element={<Diagnostico />} />
          <Route path="/log-acesso" element={<LogAcesso />} />
          <Route path="/usuarios" element={<Usuarios />} />
          <Route path="*" element={<Navigate to="/ao-vivo" replace />} />
        </Routes>
      </main>
    </div>
  );
}
