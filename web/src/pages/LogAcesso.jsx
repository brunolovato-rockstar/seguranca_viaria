import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Head, fmtDT } from '../ui.jsx';

const R = { sucesso: 'st-ok', falha: 'st-bad', bloqueio: 'st-warn', logout: 'st-mute' };

export default function LogAcesso() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api('/log-acesso').then(setRows); }, []);
  return (
    <>
      <Head crumb="Sistema" title="Log de Acesso" />
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>Data/Hora</th><th>Usuário</th><th>Resultado</th><th>Detalhe</th><th>IP</th><th>Navegador</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}><td className="mono">{fmtDT(r.criado_em)}</td><td className="mono">{r.usuario_txt}</td>
                <td><span className={`badge ${R[r.resultado]}`}>{r.resultado}</span></td><td>{r.detalhe}</td>
                <td className="mono">{r.ip}</td><td className="muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.user_agent}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
