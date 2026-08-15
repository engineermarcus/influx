'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { Icons } from './icons';

interface FloatingHudProps {
  src: string | null;
  label: string;
  onClose: () => void;
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MARGIN = 12;
const MIN_W = 160;
const MIN_H = 140;
const HEADER_H = 32;

export function FloatingHud({ src, label, onClose }: FloatingHudProps) {
  // pos = offset of the box's right/bottom edge from the viewport's right/bottom edge
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 220, h: 165 + HEADER_H });

  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeState = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    origW: number;
    origH: number;
    origPosX: number;
    origPosY: number;
  } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    setPos({ x: MARGIN, y: MARGIN });
  }, []);

  // ── drag to move (header bar) ────────────────────────────────
  const onDragPointerDown = useCallback((e: React.PointerEvent) => {
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    setDragging(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [pos]);

  const onDragPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    let nx = dragState.current.origX - dx;
    let ny = dragState.current.origY - dy;
    const w = boxRef.current?.offsetWidth ?? size.w;
    const h = boxRef.current?.offsetHeight ?? size.h;
    nx = Math.min(Math.max(nx, MARGIN), window.innerWidth - w - MARGIN);
    ny = Math.min(Math.max(ny, MARGIN), window.innerHeight - h - MARGIN);
    setPos({ x: nx, y: ny });
  }, [size]);

  const onDragPointerUp = useCallback(() => {
    dragState.current = null;
    setDragging(false);
  }, []);

  // ── drag to resize (4 edges) ─────────────────────────────────
  const startResize = useCallback((dir: ResizeDir) => (e: React.PointerEvent) => {
    e.stopPropagation();
    resizeState.current = {
      dir,
      startX: e.clientX,
      startY: e.clientY,
      origW: size.w,
      origH: size.h,
      origPosX: pos.x,
      origPosY: pos.y,
    };
    setResizing(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [size, pos]);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    const rs = resizeState.current;
    if (!rs) return;
    const dx = e.clientX - rs.startX;
    const dy = e.clientY - rs.startY;

    let nw = rs.origW;
    let nh = rs.origH;
    let nx = rs.origPosX;
    let ny = rs.origPosY;

    // box is anchored via right/bottom offsets (pos.x/pos.y from viewport edge).
    // 'e' (right edge) and 's' (bottom edge) grow away from that anchor, so
    // pos must shrink by the same delta to keep the box's own opposite edge fixed.
    // 'w' (left edge) and 'n' (top edge) grow toward the anchor, so pos grows instead.
    // Corners (e.g. 'se', 'nw') just apply both axes' logic at once.
    if (rs.dir.includes('e')) {
      nw = rs.origW + dx;
      nx = rs.origPosX - dx;
    } else if (rs.dir.includes('w')) {
      nw = rs.origW - dx;
    }
    if (rs.dir.includes('s')) {
      nh = rs.origH + dy;
      ny = rs.origPosY - dy;
    } else if (rs.dir.includes('n')) {
      nh = rs.origH - dy;
    }

    // clamp width/height to sane bounds, and re-derive position clamps
    // so growing past the viewport edge doesn't fling the box offscreen
    nw = Math.min(Math.max(nw, MIN_W), window.innerWidth - MARGIN * 2);
    nh = Math.min(Math.max(nh, MIN_H), window.innerHeight - MARGIN * 2);
    nx = Math.min(Math.max(nx, MARGIN), window.innerWidth - nw - MARGIN);
    ny = Math.min(Math.max(ny, MARGIN), window.innerHeight - nh - MARGIN);

    setSize({ w: nw, h: nh });
    setPos({ x: nx, y: ny });
  }, []);

  const onResizePointerUp = useCallback(() => {
    resizeState.current = null;
    setResizing(false);
  }, []);

  const isBusy = dragging || resizing;

  const edgeHandleProps = (dir: ResizeDir) => ({
    onPointerDown: startResize(dir),
    onPointerMove: onResizePointerMove,
    onPointerUp: onResizePointerUp,
    onPointerCancel: onResizePointerUp,
  });

  return (
    <div
      ref={boxRef}
      style={{ right: pos.x, bottom: pos.y, width: size.w, height: size.h }}
      className="fixed z-[70] rounded-xl border border-amber/40 bg-surface/95 backdrop-blur-md overflow-visible animate-pulse-ring flex flex-col"
    >
      <div className="absolute inset-0 rounded-xl overflow-hidden flex flex-col">
        <div
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-raised border-b border-border cursor-grab active:cursor-grabbing touch-none select-none shrink-0"
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

        <div className="flex-1 bg-raised flex items-center justify-center min-h-0">
          {src ? (
            <img src={src} alt={`${label} preview`} className="max-w-full max-h-full object-contain" draggable={false} />
          ) : (
            <span className="text-[10px] text-dim px-2 text-center">Nothing recomposed yet</span>
          )}
        </div>
      </div>

      {/* edge resize handles — thin strips just outside each side */}
      <div {...edgeHandleProps('n')} className="absolute -top-1 left-3 right-3 h-2 cursor-ns-resize touch-none" />
      <div {...edgeHandleProps('s')} className="absolute -bottom-1 left-3 right-3 h-2 cursor-ns-resize touch-none" />
      <div {...edgeHandleProps('w')} className="absolute -left-1 top-3 bottom-3 w-2 cursor-ew-resize touch-none" />
      <div {...edgeHandleProps('e')} className="absolute -right-1 top-3 bottom-3 w-2 cursor-ew-resize touch-none" />

      {/* corner resize handles — small squares, take priority over edges at the corners */}
      <div {...edgeHandleProps('nw')} className="absolute -top-1 -left-1 w-3 h-3 cursor-nwse-resize touch-none" />
      <div {...edgeHandleProps('ne')} className="absolute -top-1 -right-1 w-3 h-3 cursor-nesw-resize touch-none" />
      <div {...edgeHandleProps('sw')} className="absolute -bottom-1 -left-1 w-3 h-3 cursor-nesw-resize touch-none" />
      <div {...edgeHandleProps('se')} className="absolute -bottom-1 -right-1 w-3 h-3 cursor-nwse-resize touch-none" />

      {isBusy && <div className="fixed inset-0 z-[-1]" />}
    </div>
  );
}