import { useState } from 'react';
import { api, setToken } from '../api.js';
import { useApp } from '../App.jsx';
import { Icon } from '../ui.jsx';
import bg from '../assets/bg.jpg';
import logo from '../assets/logo_allwhite.png';

export default function Login() {
  const { setUser } = useApp();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [manter, setManter] = useState(true);
  const [ver, setVer] = useState(false);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);

  const entrar = async (e) => {
    e.preventDefault();
    setErro('');
    setBusy(true);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { usuario, senha, manter } });
      setToken(r.token, manter);
      setUser(r.usuario);
    } catch (err) {
      setErro(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="login" style={{ backgroundImage: `url(${bg})` }}>
      <div className="lg-col">
        <img className="lg-logo" src={logo} alt="Pumatronix" />
        <div>
          <div className="lg-hero"><div className="eb">Plataforma de analíticos</div><h1>Segurança Viária</h1></div>
          <p className="lg-sub">Analíticos de IA que salvam vidas.</p>
        </div>
        <form className="lg-card" onSubmit={entrar}>
          <h2>Entrar na plataforma</h2>
          <div className="field"><label htmlFor="lu">Usuário</label>
            <div className="inp"><Icon n="user" /><input id="lu" autoComplete="username" placeholder="Seu usuário" value={usuario} onChange={(e) => setUsuario(e.target.value)} /></div></div>
          <div className="field"><label htmlFor="lp">Senha</label>
            <div className="inp"><Icon n="lock" /><input id="lp" type={ver ? 'text' : 'password'} autoComplete="current-password" placeholder="Sua senha" value={senha} onChange={(e) => setSenha(e.target.value)} />
              <button type="button" onClick={() => setVer(!ver)} aria-label="Mostrar senha"><Icon n="eye" /></button></div></div>
          <div className="row">
            <label className="chk"><input type="checkbox" checked={manter} onChange={(e) => setManter(e.target.checked)} /> Manter conectado</label>
            <a className="link" href="#" onClick={(e) => { e.preventDefault(); setErro('Peça ao administrador para redefinir sua senha.'); }}>Esqueci a senha</a>
          </div>
          <button className="go" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
          {erro && <div className="err">{erro}</div>}
        </form>
        <div className="lg-feats">
          <div><svg viewBox="0 0 24 24"><path d="M5 17h14v-4l-2-5H7l-2 5z" /><path d="M5 13h14M6 17v2M18 17v2" /></svg>Monitoramento<br />de veículos</div>
          <div><svg viewBox="0 0 24 24"><rect x="4" y="13" width="3.5" height="7" /><rect x="10.25" y="9" width="3.5" height="11" /><rect x="16.5" y="4" width="3.5" height="16" /></svg>Análise de<br />tráfego</div>
          <div><svg viewBox="0 0 24 24"><path d="M12 3L2 20h20z" /><path d="M12 9.5v5M12 17.2v.3" /></svg>Detecção<br />de incidentes</div>
          <div><svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M12 3v18M12 9h8" /></svg>Segurança<br />e conformidade</div>
        </div>
      </div>
    </section>
  );
}
