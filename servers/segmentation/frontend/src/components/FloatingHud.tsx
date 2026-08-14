'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { Icons } from './icons';

interface FloatingHudProps {
  src: string | null;
  label: string;
  onClose: () => void;
}

const MARGIN = 12;

export function FloatingHud({ src, label, onClose }: FloatingHudProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 }); // offset from bottom-right, set on mount
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    // initial position: bottom-right corner
    setPos({ x: MARGIN, y: MARGIN });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    setDragging(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    // dragging right/down should *decrease* offset-from-edge (x,y are distances from bottom-right)
    let nx = dragState.current.origX - dx;
    let ny = dragState.current.origY - dy;
    const w = boxRef.current?.offsetWidth ?? 220;
    const h = boxRef.current?.offsetHeight ?? 180;
    nx = Math.min(Math.max(nx, MARGIN), window.innerWidth - w - MARGIN);
    ny = Math.min(Math.max(ny, MARGIN), window.innerHeight - h - MARGIN);
    setPos({ x: nx, y: ny });
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
    setDragging(false);
  }, []);

  return (
    <div
      ref={boxRef}
      style={{ right: pos.x, bottom: pos.y }}
      className="fixed z-[70] w-[38vw] max-w-[260px] min-w-[160px] sm:w-[220px] rounded-xl border border-amber/40 bg-surface/95 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden animate-pulse-ring"
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-raised border-b border-border cursor-grab active:cursor-grabbing touch-none select-none"
      >
        <Icons.Grip className="w-3.5 h-3.5 text-dim shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber flex-1 truncate">
          {label} · live
        </span>
        <button
          onClick={onClose}
          className="text-muted hover:text-text transition-colors p-0.5"
          aria-label="Close preview"
        >
          <Icons.Close className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="aspect-[4/3] bg-raised flex items-center justify-center">
        {src ? (
          <img src={src} alt={`${label} preview`} className="max-w-full max-h-full object-contain" draggable={false} />
        ) : (
          <span className="text-[10px] text-dim px-2 text-center">Nothing recomposed yet</span>
        )}
      </div>
      {dragging && <div className="fixed inset-0 z-[-1]" />}
    </div>
  );
}
