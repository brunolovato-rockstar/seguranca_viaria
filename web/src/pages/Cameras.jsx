import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { bus, useApp } from '../App.jsx';
import { AN_ICON, Head, Icon, ago, groupOf } from '../ui.jsx';

const FINS = [
  { k: 'interior', n: 'Interior do veículo', ans: ['cinto', 'passageiro', 'celular', 'fumar', 'anpr'] },
  { k: 'moto', n: 'Motocicletas', ans: ['capacete', 'sobrecarga', 'anpr'] },
  { k: 'via', n: 'Panorâmica da via', ans: ['contramao', 'faixa', 'estacionamento', 'naomotor', 'congest', 'devagar', 'velocidade'] },
  { k: 'ocr', n: 'Leitura de placa', ans: ['anpr', 'velocidade'] },
  { k: 'custom', n: 'Personalizada', ans: null },
];
const finName = (k) => FINS.find((f) => f.k === k)?.n || 'Personalizada';
const ESTADO = { online: 'st-ok', conectando: 'st-warn', erro: 'st-bad' };
const NOVA = { nome: '', url_base: 'http://localhost:63519', usuario: 'admin', senha: '', acesso: 'http_api', modo_eventos: 'attachFileProc', canal: 1, faixas: 2, finalidade: 'custom', analiticos: [], rodovia: 'BR-376', km: '', pista: '', latitude: '', longitude: '', ativo: 1 };

export default function Cameras() {
  const { user } = useApp();
  const [list, setList] = useState([]);
  const [status, setStatus] = useState({});
  const [ans, setAns] = useState([]);
  const [form, setForm] = useState(null);
  const load = () => Promise.all([api('/cameras'), api('/cameras/status')]).then(([l, s]) => { setList(l); setStatus(s); });
  useEffect(() => {
    load();
    api('/analiticos').then(setAns);
    const on = (e) => setStatus((s) => ({ ...s, [e.detail.camera_id]: e.detail.status }));
    bus.addEventListener('camera_status', on);
    return () => bus.removeEventListener('camera_status', on);
  }, []);
  const admin = user.perfil === 'admin';

  return (
    <>
      <Head crumb="Dispositivos" title="Câmeras">{admin && <button className="btn pri" onClick={() => setForm({ ...NOVA })}><Icon n="plus" />Adicionar câmera</button>}</Head>
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>ID</th><th>Nome / finalidade</th><th>Endereço</th><th>Acesso</th><th>Equipamento</th><th>Analíticos</th><th>Eventos</th><th /></tr></thead>
          <tbody>
            {!list.length && <tr><td colSpan={8} className="empty">Nenhuma câmera.</td></tr>}
            {list.map((c) => {
              const s = status[c.id] || {};
              return (
                <tr key={c.id}>
                  <td className="mono">{c.codigo}</td>
                  <td>{c.nome}<br /><small className="muted">{finName(c.finalidade)}</small></td>
                  <td className="mono" style={{ fontSize: 12.5 }}>{c.url_base}<br /><small className="muted">{c.usuario}{c.tem_senha ? ' · senha salva' : ' · sem senha'}</small></td>
                  <td><span className="badge st-mute">{c.acesso === 'http_api' ? `API HTTP · ${c.modo_eventos}` : c.acesso === 'itsapi_push' ? 'ITSAPI (push)' : 'SDK nativo'}</span></td>
                  <td>{c.modelo || '—'}<br /><small className="muted mono">{c.serial || ''}</small></td>
                  <td style={{ whiteSpace: 'normal' }}><div className="chips">{c.analiticos.length ? c.analiticos.map((k) => { const a = ans.find((x) => x.chave === k); const g = groupOf(a?.grupo); return <span key={k} className="anb" style={{ color: g.c, background: g.bg }}><Icon n={AN_ICON[k]} />{a?.nome || k}</span>; }) : <small className="muted">Todos os recebidos</small>}</div></td>
                  <td><span className={`badge ${ESTADO[s.estado] || 'st-mute'}`}>{s.estado || '—'}</span><br /><small className="muted">{s.ultimoEvento ? `último ${ago(s.ultimoEvento)}` : s.erro || ''}</small></td>
                  <td>{admin && <button className="btn sm" onClick={() => setForm({ ...NOVA, ...c, senha: '', km: c.km ?? '', latitude: c.latitude ?? '', longitude: c.longitude ?? '' })}>Editar</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {form && <CameraForm init={form} ans={ans} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </>
  );
}

function CameraForm({ init, ans, onClose, onSaved }) {
  const { toast } = useApp();
  const [c, setC] = useState(init);
  const [teste, setTeste] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setC({ ...c, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });
  const setFin = (k) => { const f = FINS.find((x) => x.k === k); setC({ ...c, finalidade: k, analiticos: f.ans ? [...f.ans] : c.analiticos }); };
  const toggleAn = (k) => {
    const list = c.analiticos.includes(k) ? c.analiticos.filter((x) => x !== k) : [...c.analiticos, k];
    const cur = [...list].sort().join();
    const m = FINS.find((f) => f.ans && [...f.ans].sort().join() === cur);
    setC({ ...c, analiticos: list, finalidade: m ? m.k : 'custom' });
  };

  const testar = async () => {
    setTeste({ estado: 'testando' });
    try {
      const r = await api('/cameras/testar', { method: 'POST', body: { id: c.id, url_base: c.url_base, usuario: c.usuario, senha: c.senha, canal: c.canal } });
      setTeste({ estado: 'ok', info: r.info });
    } catch (e) { setTeste({ estado: 'erro', erro: e.message }); }
  };
  const salvar = async () => {
    if (!c.nome || !c.url_base) { toast('Informe nome e URL.', 'bad'); return; }
    setBusy(true);
    try {
      await api(c.id ? `/cameras/${c.id}` : '/cameras', { method: c.id ? 'PUT' : 'POST', body: c });
      toast(c.id ? 'Câmera atualizada. Reconectando eventos…' : 'Câmera cadastrada. Conectando…');
      onSaved();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const remover = async () => {
    if (!window.confirm(`Remover ${c.codigo}? Os registros continuam no banco.`)) return;
    await api(`/cameras/${c.id}`, { method: 'DELETE' });
    onSaved();
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mwrap sm"><div className="modal">
        <div className="panel-h">{c.id ? `Editar câmera · ${c.codigo}` : 'Adicionar câmera'}<span className="r"><button className="btn icon" onClick={onClose}>✕</button></span></div>
        <div className="form">
          <div className="f full"><label>Nome / local</label><input value={c.nome} onChange={set('nome')} placeholder="km 611 · Pista Norte" /></div>
          <div className="f full"><label>URL da câmera</label><input className="mono" value={c.url_base} onChange={set('url_base')} placeholder="http://localhost:63519" /><span className="hint">Para o túnel: http://localhost:63519 (porta 80 da câmera). Na rede: http://IP-da-câmera</span></div>
          <div className="f"><label>Usuário</label><input value={c.usuario} onChange={set('usuario')} autoComplete="off" name="cam-usuario" /></div>
          <div className="f"><label>Senha</label><input type="password" value={c.senha} onChange={set('senha')} placeholder={c.id ? '(mantém a atual)' : ''} autoComplete="new-password" name="cam-senha" data-lpignore="true" /></div>
          <div className="f"><label>Acesso aos eventos</label><select value={c.acesso} onChange={set('acesso')}><option value="http_api">API HTTP (o servidor busca)</option><option value="itsapi_push">ITSAPI (a câmera envia)</option><option value="sdk">SDK nativo (fase futura)</option></select></div>
          <div className="f"><label>Modo do fluxo (API HTTP)</label><select value={c.modo_eventos} onChange={set('modo_eventos')} disabled={c.acesso !== 'http_api'}><option value="attachFileProc">snapManager · eventos com imagem</option><option value="eventManager">eventManager · texto + snapshot</option><option value="desligado">Desligado (só ao vivo)</option></select></div>
          <div className="f"><label>Canal</label><input type="number" min="1" value={c.canal} onChange={set('canal')} /></div>
          <div className="f"><label>Nº de faixas</label><input type="number" min="1" value={c.faixas} onChange={set('faixas')} /></div>
          <div className="f full"><label>URL RTSP (vídeo ao vivo)</label><input className="mono" value={c.rtsp_url || ''} onChange={set('rtsp_url')} placeholder="rtsp://localhost:63554/cam/realmonitor?channel=1&subtype=0" /><span className="hint">Sem usuário/senha (o servidor usa os desta câmera). Pelo túnel, aponte para a porta local que leva à 554 da câmera.</span></div>
          {c.acesso === 'itsapi_push' && <div className="f full"><label>DeviceID (ITSAPI)</label><input className="mono" value={c.device_id || ''} onChange={set('device_id')} placeholder="preenchido sozinho no primeiro push" /></div>}
          <div className="testbox" style={{ background: teste?.estado === 'ok' ? 'var(--ok-bg)' : teste?.estado === 'erro' ? 'var(--bad-bg)' : 'var(--panel2)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn" onClick={testar} disabled={teste?.estado === 'testando'}><Icon n="plug" />{teste?.estado === 'testando' ? 'Testando…' : 'Testar conexão'}</button>
              {teste?.estado === 'ok' && <span style={{ color: 'var(--ok)' }}><b>Conectou</b> · {teste.info.modelo} · série {teste.info.serial} · {teste.info.latencia_ms} ms</span>}
              {teste?.estado === 'erro' && <span style={{ color: 'var(--bad)' }}>{teste.erro}</span>}
              {!teste && <span className="muted">Lê modelo, série e firmware pela API da câmera.</span>}
            </div>
            {teste?.estado === 'ok' && <div className="muted mono" style={{ fontSize: 12, marginTop: 6 }}>Firmware {teste.info.firmware || '—'} · hora da câmera {teste.info.hora_camera || '—'}</div>}
          </div>
          <div className="sect">Finalidade e analíticos</div>
          <div className="f full"><label>Finalidade (enquadramento)</label><select value={c.finalidade} onChange={(e) => setFin(e.target.value)}>{FINS.map((f) => <option key={f.k} value={f.k}>{f.n}</option>)}</select></div>
          <div className="f full"><div className="angrid">{ans.map((a) => (
            <label key={a.chave}><input type="checkbox" checked={c.analiticos.includes(a.chave)} onChange={() => toggleAn(a.chave)} /><span style={{ color: groupOf(a.grupo).c, display: 'flex' }}><Icon n={AN_ICON[a.chave]} style={{ width: 15, height: 15 }} /></span>{a.nome}</label>
          ))}</div></div>
          <div className="sect">Localização</div>
          <div className="f"><label>Rodovia</label><input value={c.rodovia || ''} onChange={set('rodovia')} /></div>
          <div className="f"><label>km</label><input value={c.km} onChange={set('km')} placeholder="611,2" /></div>
          <div className="f"><label>Latitude</label><input className="mono" value={c.latitude} onChange={set('latitude')} placeholder="-25.80512" /></div>
          <div className="f"><label>Longitude</label><input className="mono" value={c.longitude} onChange={set('longitude')} placeholder="-49.10433" /></div>
          <label className="f full" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 16, height: 16 }} checked={!!c.ativo} onChange={set('ativo')} />Câmera ativa</label>
        </div>
        <div className="mf">{c.id && <button className="btn" style={{ marginRight: 'auto', color: 'var(--bad)' }} onClick={remover}>Remover</button>}<button className="btn" onClick={onClose}>Cancelar</button><button className="btn pri" disabled={busy} onClick={salvar}>Salvar</button></div>
      </div></div>
    </div>
  );
}
