// Pop-up do registro: analítico em destaque, validação com assinatura, correção de placa,
// histórico e navegação ← → entre os registros da lista de onde foi aberto.
import { useEffect, useState, useCallback } from 'react';
import { api, media } from '../api.js';
import { useApp } from '../App.jsx';
import ImageZoom, { ZoomBox } from './ImageZoom.jsx';
import { AN_ICON, Icon, Plate, PrfBadge, fmtD, fmtDT, fmtT, groupOf } from '../ui.jsx';

const PLACA_RX = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const MOTIVOS = ['Leitura OCR incorreta', 'Placa não lida pela câmera', 'Caractere ilegível', 'Outro'];

export default function EventModal({ id, ids = [], onClose, onChange }) {
  const { user, toast } = useApp();
  const [cur, setCur] = useState(id);
  const [ev, setEv] = useState(null);
  const [just, setJust] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [edit, setEdit] = useState(null); // { placa, motivo, erro }
  const [zoom, setZoom] = useState(null); // índice da foto aberta no visualizador

  const load = useCallback(() => api(`/eventos/${cur}`).then(setEv).catch((e) => toast(e.message, 'bad')), [cur, toast]);
  useEffect(() => { setEv(null); setEdit(null); setZoom(null); load(); }, [load]);

  const pos = ids.indexOf(cur);
  const prev = pos > 0 ? ids[pos - 1] : null;
  const next = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : null;

  const validar = useCallback(async () => {
    if (!ev || ev.status_validacao === 'validado') return;
    try {
      const r = await api(`/eventos/${ev.id}/validar`, { method: 'POST' });
      setEv(r);
      setJust(true);
      setTimeout(() => setJust(false), 1500);
      toast(`Registro #${r.id} validado por ${user.usuario}.`);
      onChange?.(r);
    } catch (e) { toast(e.message, 'bad'); }
  }, [ev, toast, user, onChange]);

  const salvarPlaca = async () => {
    const placa = edit.placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!PLACA_RX.test(placa)) { setEdit({ ...edit, erro: 'Formato inválido. Use ABC1D23 ou ABC1234.' }); return; }
    try {
      const r = await api(`/eventos/${ev.id}/placa`, { method: 'POST', body: { placa, motivo: edit.motivo } });
      setEv(r); setEdit(null); setShowLog(true);
      toast(`Placa do registro #${r.id} corrigida para ${placa}.`);
      onChange?.(r);
    } catch (e) { setEdit({ ...edit, erro: e.message }); }
  };

  const g = groupOf(ev?.analitico_grupo);
  const imgEvento = ev?.imagens.find((i) => i.tipo === 'evento' || i.tipo === 'composta') || ev?.imagens[0];
  const imgOutra = ev?.imagens.find((i) => i !== imgEvento);
  const bbox = ev?.bbox && Array.isArray(ev.bbox) ? ev.bbox.map(Number) : null;
  const bboxStyle = bbox && bbox[2] > bbox[0] ? { left: `${bbox[0] / 81.92}%`, top: `${bbox[1] / 81.92}%`, width: `${(bbox[2] - bbox[0]) / 81.92}%`, height: `${(bbox[3] - bbox[1]) / 81.92}%` } : null;
  const lblEvento = imgEvento?.tipo === 'outro' ? 'Snapshot na hora do evento' : 'Imagem do evento';
  const lblOutra = imgOutra?.tipo === 'placa' ? 'Recorte da placa' : 'Imagem complementar';
  const fotos = [
    imgEvento && { src: media(imgEvento.url), label: lblEvento, bbox: bboxStyle && { ...bboxStyle, borderColor: g.c } },
    imgOutra && { src: media(imgOutra.url), label: lblOutra },
  ].filter(Boolean);

  useEffect(() => {
    const k = (e) => {
      if (zoom != null || e.target.closest('input,select,textarea')) return;
      if (e.key === 'z' || e.key === 'Z') { if (imgEvento || imgOutra) setZoom(0); return; }
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && prev) setCur(prev);
      if (e.key === 'ArrowRight' && next) setCur(next);
      if (e.key === 'v' || e.key === 'V') validar();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [prev, next, validar, onClose, zoom, imgEvento, imgOutra]);

  const corrigida = !!ev?.placa_ocr;
  const ultimaCorr = ev?.log?.find((l) => l.acao === 'Placa corrigida');

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mwrap">
        <button className="navarrow l" disabled={!prev} onClick={() => setCur(prev)} title="Anterior (←)"><Icon n="chevL" /></button>
        <button className="navarrow r" disabled={!next} onClick={() => setCur(next)} title="Próximo (→)"><Icon n="chevR" /></button>
        <div className="modal">
          {!ev ? <div className="empty">Carregando…</div> : (
            <>
              <div className="dt-head" style={{ '--gc': g.c, '--gbg': g.bg }}>
                <div className="dt-ic"><Icon n={AN_ICON[ev.chave]} /></div>
                <div className="dt-tt"><small>{g.n}</small><h2>{ev.analitico_nome || ev.codigo_origem}</h2><p>Código da câmera: <span className="mono">{ev.codigo_origem}</span> · origem {ev.origem === 'itsapi' ? 'ITSAPI (push)' : 'HTTP API'}</p></div>
                <div className="dt-r"><div><b>#{ev.id}</b>{fmtDT(ev.ocorrido_em)}{pos >= 0 && <div>{pos + 1} de {ids.length}</div>}</div><button className="btn icon" onClick={onClose} aria-label="Fechar">✕</button></div>
              </div>
              {ev.status_validacao === 'validado' ? (
                <div className={`vband ok ${just ? 'just' : ''}`}>
                  <span className="vbig"><Icon n="check" /></span>
                  <div><b>Validado por {ev.validado_por_nome}</b><small>Usuário <span className="mono">{ev.validado_por_usuario}</span> · validado em {fmtD(ev.validado_em)} às {fmtT(ev.validado_em)} · assinatura enviada junto ao registro para a PRF</small></div>
                </div>
              ) : (
                <div className="vband">
                  <div><b>Aguardando validação</b><small>Confira as imagens e valide para assinar o registro com o seu usuário ({user.usuario}).</small></div>
                  <button className="btn pri lg" onClick={validar}><Icon n="check" />Validar registro<kbd>V</kbd></button>
                </div>
              )}
              <div className="dt-chips">
                <span>Câmera <b>{ev.camera_codigo || '—'} · {ev.camera_nome || ''}</b></span>
                {ev.camera_km && <span>Local <b>{ev.camera_rodovia} km {String(ev.camera_km).replace('.', ',')}</b></span>}
                <span>Faixa <b>{ev.faixa ?? '—'}</b></span>
                {ev.sentido && <span>Sentido <b>{ev.sentido}</b></span>}
                <span>Envio PRF <PrfBadge s={ev.status_prf} /></span>
              </div>
              <div className={`dt-imgs ${imgOutra ? '' : 'one'}`}>
                <div className="cap"><i>{lblEvento}</i>
                  {imgEvento ? (
                    <ZoomBox src={media(imgEvento.url)} alt={lblEvento} bbox={bboxStyle && { ...bboxStyle, borderColor: g.c }} onFull={() => setZoom(0)} />
                  ) : <span className="noimg">Sem imagem neste evento</span>}
                </div>
                {imgOutra && (
                  <div className="cap"><i>{lblOutra}</i>
                    <ZoomBox src={media(imgOutra.url)} alt={lblOutra} onFull={() => setZoom(imgEvento ? 1 : 0)} />
                  </div>
                )}
              </div>
              <div className="kv">
                <div>
                  {edit ? (
                    <>
                      <small>Corrigir placa</small>
                      <div className="pl-form">
                        <input autoFocus maxLength={8} value={edit.placa} placeholder="ABC1D23" onChange={(e) => setEdit({ ...edit, placa: e.target.value.toUpperCase(), erro: '' })} onKeyDown={(e) => { if (e.key === 'Enter') salvarPlaca(); if (e.key === 'Escape') { e.stopPropagation(); setEdit(null); } }} />
                        <select value={edit.motivo} onChange={(e) => setEdit({ ...edit, motivo: e.target.value })}>{MOTIVOS.map((m) => <option key={m}>{m}</option>)}</select>
                      </div>
                      <div className="pl-row" style={{ marginTop: 6 }}><button className="btn sm pri" onClick={salvarPlaca}>Salvar</button><button className="btn sm" onClick={() => setEdit(null)}>Cancelar</button><span className="pl-err">{edit.erro}</span></div>
                    </>
                  ) : (
                    <>
                      <small>Placa{corrigida && <span className="tag-ed">corrigida</span>}</small>
                      <div className="pl-row"><Plate p={ev.placa} lg />{ev.placa_confianca != null && !corrigida && <span className="muted" style={{ fontSize: 12 }}>{ev.placa_confianca}%</span>}
                        <button className="btn sm" onClick={() => setEdit({ placa: ev.placa || '', motivo: MOTIVOS[0], erro: '' })}><Icon n="edit" />{ev.placa ? 'Corrigir' : 'Informar'}</button></div>
                      {corrigida && <div className="ocr">OCR: <s className="mono">{ev.placa_ocr === 'NAO_LIDA' ? 'não lida' : ev.placa_ocr}</s>{ultimaCorr && ` · por ${ultimaCorr.usuario_txt}`}</div>}
                    </>
                  )}
                </div>
                <div><small>Veículo</small><b>{ev.tipo_veiculo || '—'}</b></div>
                <div><small>Marca</small><b>{ev.marca || '—'}</b></div>
                <div><small>Cor</small><b>{ev.cor_veiculo || '—'}</b></div>
                <div><small>Velocidade</small><b>{ev.velocidade != null ? `${ev.velocidade} km/h` : '—'}</b></div>
              </div>
              <div className="dt-log">
                <button className="dt-log-h" onClick={() => setShowLog(!showLog)}><Icon n="history" />Histórico de alterações<span className="cnt">{ev.log?.length || 0}</span><Icon n="down" style={{ marginLeft: 'auto', transform: showLog ? 'rotate(180deg)' : 'none' }} /></button>
                {showLog && (
                  <ol className="tl">
                    {ev.log.map((l, i) => (
                      <li key={i} className={l.usuario_txt === 'sistema' ? 'sys' : ''}>
                        <span className="t">{fmtDT(l.criado_em)}</span><span className="u">{l.usuario_txt === 'sistema' ? 'Sistema' : l.usuario_txt}</span>
                        <span className="a">{l.acao}</span><span className="d">{l.detalhe}{l.motivo && <i> · {l.motivo}</i>}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div className="mf"><span className="sp">Use ← → para navegar · roda do mouse amplia a foto · Z tela cheia{ev.status_validacao !== 'validado' && ' · V para validar'}</span><button className="btn" onClick={onClose}>Fechar</button></div>
            </>
          )}
        </div>
      </div>
      {zoom != null && fotos.length > 0 && <ImageZoom imagens={fotos} start={Math.min(zoom, fotos.length - 1)} onClose={() => setZoom(null)} />}
    </div>
  );
}
