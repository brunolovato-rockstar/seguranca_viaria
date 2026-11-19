import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Head, Icon, fmtDT } from '../ui.jsx';

export default function Usuarios() {
  const { toast } = useApp();
  const [rows, setRows] = useState([]);
  const [f, setF] = useState(null);
  const load = () => api('/usuarios').then(setRows);
  useEffect(() => { load(); }, []);
  const salvar = async () => {
    try { await api('/usuarios', { method: 'POST', body: f }); toast('Usuário criado.'); setF(null); load(); } catch (e) { toast(e.message, 'bad'); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <Head crumb="Sistema" title="Usuários"><button className="btn pri" onClick={() => setF({ usuario: '', nome: '', email: '', perfil: 'operador', senha: '' })}><Icon n="plus" />Novo usuário</button></Head>
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>Usuário</th><th>Nome</th><th>Perfil</th><th>E-mail</th><th>Situação</th><th>Último acesso</th></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id}><td className="mono">{u.usuario}</td><td>{u.nome}</td><td><span className={`badge ${u.perfil === 'admin' ? 'st-warn' : 'st-mute'}`}>{u.perfil}</span></td><td>{u.email || '—'}</td>
              <td>{u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date() ? <span className="badge st-bad">bloqueado</span> : u.ativo ? <span className="badge st-ok">ativo</span> : <span className="badge st-mute">inativo</span>}</td>
              <td className="mono">{fmtDT(u.ultimo_acesso)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {f && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setF(null)}>
          <div className="mwrap sm"><div className="modal">
            <div className="panel-h">Novo usuário</div>
            <div className="form">
              <div className="f"><label>Usuário</label><input value={f.usuario} onChange={set('usuario')} placeholder="prf.andrade" /></div>
              <div className="f"><label>Nome</label><input value={f.nome} onChange={set('nome')} /></div>
              <div className="f"><label>E-mail</label><input value={f.email} onChange={set('email')} /></div>
              <div className="f"><label>Perfil</label><select value={f.perfil} onChange={set('perfil')}><option value="operador">Operador</option><option value="admin">Administrador</option></select></div>
              <div className="f full"><label>Senha inicial</label><input type="password" value={f.senha} onChange={set('senha')} /><span className="hint">Mínimo 6 caracteres</span></div>
            </div>
            <div className="mf"><button className="btn" onClick={() => setF(null)}>Cancelar</button><button className="btn pri" onClick={salvar}>Salvar</button></div>
          </div></div>
        </div>
      )}
    </>
  );
}
