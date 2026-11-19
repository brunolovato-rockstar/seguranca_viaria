import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { AN_ICON, Head, Icon, groupOf } from '../ui.jsx';

const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function Analiticos() {
  const { user } = useApp();
  const [list, setList] = useState([]);
  const load = () => api('/analiticos').then(setList);
  useEffect(() => { load(); }, []);
  const gravar = (a) => api(`/analiticos/${a.chave}`, { method: 'PUT', body: { ativo: !a.ativo } }).then(load);
  return (
    <>
      <Head crumb="Dispositivos" title="Analíticos de IA"><span className="badge st-mute">Executados na própria câmera</span></Head>
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>Analítico</th><th>Grupo</th><th>Tipo</th><th>Hoje</th><th>Gravar</th><th>Câmeras</th><th>Códigos da câmera que viram este analítico</th></tr></thead>
          <tbody>
            {list.map((a) => {
              const g = groupOf(a.grupo);
              return (
                <tr key={a.chave}>
                  <td><span style={{ color: g.c, display: 'inline-flex', gap: 8, alignItems: 'center', fontWeight: 600 }}><Icon n={AN_ICON[a.chave]} />{a.nome}</span>{a.destaque ? <span className="badge st-acc" style={{ marginLeft: 8 }}>destaque</span> : null}<br /><small className="muted">{a.descricao}</small></td>
                  <td>{g.n}</td>
                  <td>{a.infracao ? 'Infração (vai para validação)' : 'Informativo'}</td>
                  <td className="mono">{a.hoje > 0
                    ? <Link className="hoje-lk" to={`/registros?chaves=${a.chave}&de=${hojeISO()}&ate=${hojeISO()}`} title={`Ver os registros de hoje de ${a.nome}`}>{a.hoje}<Icon n="chevR" /></Link>
                    : a.hoje}</td>
                  <td>{user.perfil === 'admin' ? <span className={`toggle ${a.ativo ? 'on' : ''}`} onClick={() => gravar(a)} role="switch" aria-checked={!!a.ativo}><span className="sw" />{a.ativo ? 'Sim' : 'Não'}</span> : (a.ativo ? 'Sim' : 'Não')}</td>
                  <td>{a.cameras}</td>
                  <td style={{ whiteSpace: 'normal' }}>{a.codigos.map((c) => <span key={c} className="code" style={{ marginRight: 4 }}>{c}</span>)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Para incluir um código novo que apareça em Diagnóstico, adicione uma linha na tabela <span className="code">analitico_codigos</span> (fase 2: tela de edição).</p>
    </>
  );
}
