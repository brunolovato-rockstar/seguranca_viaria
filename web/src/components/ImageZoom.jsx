// Zoom de fotos: roda do mouse amplia direto (sem clicar), arrastar move, duplo clique alterna.
// ZoomBox = zoom dentro do próprio quadro (pop-up do registro); ImageZoom = tela cheia.
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui.jsx';

const MIN = 1, MAX = 8, STEP = 1.25;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const FIT = { s: 1, x: 0, y: 0 };

/** Estado e gestos de zoom sobre um palco (stage) com um conteúdo (content) centralizado. */
function useZoom() {
  const stage = useRef(null);
  const content = useRef(null);
  const [v, setV] = useState(FIT);
  const [drag, setDrag] = useState(null);

  // limita o arraste para a foto não sair do quadro
  const bound = useCallback((n) => {
    if (n.s <= 1) return FIT;
    const S = stage.current?.getBoundingClientRect(), c = content.current;
    if (!S || !c) return n;
    const mx = Math.max(0, (n.s * c.offsetWidth - S.width) / 2);
    const my = Math.max(0, (n.s * c.offsetHeight - S.height) / 2);
    return { s: n.s, x: clamp(n.x, -mx, mx), y: clamp(n.y, -my, my) };
  }, []);

  // amplia mantendo fixo o ponto (px,py) relativo ao centro do palco
  const zoomAt = useCallback((factor, px = 0, py = 0) => {
    setV((o) => {
      const s = clamp(o.s * factor, MIN, MAX);
      const k = s / o.s;
      return bound({ s, x: px - (px - o.x) * k, y: py - (py - o.y) * k });
    });
  }, [bound]);

  const rel = (e) => {
    const r = stage.current.getBoundingClientRect();
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2];
  };

  useEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    const onWheel = (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? STEP : 1 / STEP, ...rel(e)); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const handlers = {
    onPointerDown: (e) => {
      if (v.s === 1 || e.button !== 0 || e.target.closest('button,a')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ x: e.clientX - v.x, y: e.clientY - v.y });
    },
    onPointerMove: (e) => { if (drag) setV((o) => bound({ ...o, x: e.clientX - drag.x, y: e.clientY - drag.y })); },
    onPointerUp: () => setDrag(null),
    onPointerCancel: () => setDrag(null),
    onDoubleClick: (e) => { if (e.target.closest('button,a')) return; v.s > 1 ? setV(FIT) : zoomAt(2.5, ...rel(e)); },
  };
  const cursor = v.s > 1 ? (drag ? 'grabbing' : 'grab') : 'zoomin';
  const style = { transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})`, transition: drag ? 'none' : 'transform .12s ease-out' };
  return { stage, content, v, setV, zoomAt, handlers, cursor, style, reset: () => setV(FIT) };
}

/** Foto com zoom dentro do próprio quadro. */
export function ZoomBox({ src, alt, bbox, onFull }) {
  const z = useZoom();
  useEffect(() => z.setV(FIT), [src]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={z.stage} className={`zbox ${z.cursor}`} {...z.handlers}>
      <div ref={z.content} className="zbox-in" style={z.style}>
        <img src={src} alt={alt} draggable={false} />
        {bbox && <span className="bbox" style={{ ...bbox, borderWidth: 2 / z.v.s }} />}
      </div>
      <div className="zbox-ctl">
        {z.v.s > 1 ? (
          <>
            <span>{Math.round(z.v.s * 100)}%</span>
            <button onClick={z.reset} title="Voltar ao tamanho original (duplo clique)">Ajustar</button>
          </>
        ) : <span className="hint">Role para ampliar</span>}
        {onFull && <button onClick={onFull} title="Tela cheia (Z)"><Icon n="zoom" />Tela cheia</button>}
      </div>
    </div>
  );
}

/** Visualizador em tela cheia. ← → alterna entre as fotos do registro. */
export default function ImageZoom({ imagens, start = 0, onClose }) {
  const [idx, setIdx] = useState(start);
  const z = useZoom();
  const img = imagens[idx];
  const { setV, zoomAt } = z;

  useEffect(() => setV(FIT), [idx, setV]);

  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomAt(STEP);
      else if (e.key === '-') zoomAt(1 / STEP);
      else if (e.key === '0') setV(FIT);
      else if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setIdx((i) => Math.min(imagens.length - 1, i + 1));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, zoomAt, setV, imagens.length]);

  return createPortal(
    <div className="zv">
      <div className="zv-bar">
        <span className="zv-t">{img.label}{imagens.length > 1 && <small>{idx + 1} de {imagens.length}</small>}</span>
        <div className="zv-ctl">
          <button onClick={() => zoomAt(1 / STEP)} disabled={z.v.s <= MIN} title="Diminuir (−)">−</button>
          <span className="zv-pct">{Math.round(z.v.s * 100)}%</span>
          <button onClick={() => zoomAt(STEP)} disabled={z.v.s >= MAX} title="Aumentar (+)">+</button>
          <button className="txt" onClick={z.reset} disabled={z.v.s === 1} title="Ajustar à tela (0)">Ajustar</button>
          <a className="txt" href={img.src} target="_blank" rel="noreferrer" title="Abrir original em nova aba">Original</a>
          <button onClick={onClose} title="Fechar (Esc)" aria-label="Fechar">✕</button>
        </div>
      </div>
      <div ref={z.stage} className={`zv-stage ${z.cursor}`} {...z.handlers}
        onMouseDown={(e) => { if (e.target === e.currentTarget && z.v.s === 1) onClose(); }}>
        <div ref={z.content} className="zv-img" style={z.style}>
          <img src={img.src} alt={img.label} draggable={false} />
          {img.bbox && <span className="bbox" style={{ ...img.bbox, borderWidth: 2 / z.v.s }} />}
        </div>
        {imagens.length > 1 && (
          <>
            <button className="navarrow l" disabled={idx === 0} onClick={() => setIdx(idx - 1)} title="Foto anterior (←)"><Icon n="chevL" /></button>
            <button className="navarrow r" disabled={idx === imagens.length - 1} onClick={() => setIdx(idx + 1)} title="Próxima foto (→)"><Icon n="chevR" /></button>
          </>
        )}
      </div>
      <div className="zv-hint">Roda do mouse ou duplo clique para ampliar · arraste para mover · Esc para fechar</div>
    </div>,
    document.body,
  );
}
