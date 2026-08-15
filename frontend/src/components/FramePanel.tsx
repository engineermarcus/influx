'use client';

import { useRef, useState, useCallback } from 'react';
import { FrameCanvas } from './FrameCanvas';
import { Icons } from './icons';
import type { FrameKey } from '@/lib/types';
import { FRAME_LABELS, FRAME_HINTS } from '@/lib/types';

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const MIN_W = 200;
const MIN_H = 160;

interface FramePanelProps {
  frameKey: FrameKey;
  src: string | null;
  busy?: boolean;
  busyLabel?: string;
  canFullscreen?: boolean;
  onExpand?: () => void;
  onClickPoint?: (x: number, y: number) => void;
  onBoxSelect?: (box: [number, number, number, number]) => void;
  onPointSelect?: (x: number, y: number) => void;
  cursorStyle?: 'crosshair' | 'cell';
  onUndo?: () => void;
  canUndo?: boolean;
}

export function FramePanel({
  frameKey,
  src,
  busy,
  busyLabel,
  canFullscreen,
  onExpand,
  onClickPoint,
  onBoxSelect,
  onPointSelect,
  cursorStyle,
  onUndo,
  canUndo,
}: FramePanelProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; mt: number; ml: number } | null>(null);
  const resizeState = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    origW: number;
    origH: number;
    origMt: number;
    origMl: number;
  } | null>(null);

  const startResize = useCallback((dir: ResizeDir) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    resizeState.current = {
      dir,
      startX: e.clientX,
      startY: e.clientY,
      origW: rect.width,
      origH: rect.height,
      origMt: size?.mt ?? 0,
      origMl: size?.ml ?? 0,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [size]);

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    const rs = resizeState.current;
    if (!rs) return;
    const dx = e.clientX - rs.startX;
    const dy = e.clientY - rs.startY;

    let nw = rs.origW;
    let nml = rs.origMl;
    if (rs.dir.includes('e')) {
      nw = Math.max(MIN_W, rs.origW + dx);
    } else if (rs.dir.includes('w')) {
      nw = Math.max(MIN_W, rs.origW - dx);
      nml = rs.origMl - (nw - rs.origW);
    }

    let nh = rs.origH;
    let nmt = rs.origMt;
    if (rs.dir.includes('s')) {
      nh = Math.max(MIN_H, rs.origH + dy);
    } else if (rs.dir.includes('n')) {
      nh = Math.max(MIN_H, rs.origH - dy);
      nmt = rs.origMt - (nh - rs.origH);
    }

    setSize({ w: nw, h: nh, mt: nmt, ml: nml });
  }, []);

  const onResizeUp = useCallback(() => { resizeState.current = null; }, []);

  const handleProps = (dir: ResizeDir) => ({
    onPointerDown: startResize(dir),
    onPointerMove: onResizeMove,
    onPointerUp: onResizeUp,
    onPointerCancel: onResizeUp,
  });

  return (
    <div
      ref={cardRef}
      style={size ? { width: size.w, height: size.h, marginTop: size.mt, marginLeft: size.ml } : undefined}
      className="relative min-w-0 bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-2"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          {FRAME_LABELS[frameKey]}
        </span>
        <span className="text-[11px] text-dim hidden md:inline truncate">{FRAME_HINTS[frameKey]}</span>
        {canFullscreen && (
          <button
            onClick={onExpand}
            className="ml-auto text-muted hover:text-accent transition-colors p-1"
            aria-label={`Expand ${FRAME_LABELS[frameKey]}`}
            disabled={!src}
          >
            <Icons.Fullscreen className="w-3.5 h-3.5" />
          </button>
        )}
        {onUndo && (
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="ml-auto text-muted hover:text-accent transition-colors p-1 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Undo last change"
          >
            <Icons.Undo className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className={size ? 'flex-1 min-h-0' : 'aspect-[4/3]'}>
        <FrameCanvas
          src={src}
          alt={FRAME_LABELS[frameKey]}
          emptyLabel={frameKey === 'input' ? 'Upload an image to begin' : '—'}
          busy={busy}
          busyLabel={busyLabel}
          onClickPoint={onClickPoint}
          onBoxSelect={onBoxSelect}
          onPointSelect={onPointSelect}
          cursorStyle={cursorStyle}
        />
      </div>

      <div {...handleProps('n')} className="absolute -top-1 left-3 right-3 h-2 cursor-ns-resize touch-none" />
      <div {...handleProps('s')} className="absolute left-3 right-3 -bottom-1 h-2 cursor-ns-resize touch-none" />
      <div {...handleProps('w')} className="absolute -left-1 top-3 bottom-3 w-2 cursor-ew-resize touch-none" />
      <div {...handleProps('e')} className="absolute top-3 bottom-3 -right-1 w-2 cursor-ew-resize touch-none" />

      <div {...handleProps('nw')} className="absolute -top-1 -left-1 w-3 h-3 cursor-nwse-resize touch-none z-10" />
      <div {...handleProps('ne')} className="absolute -top-1 -right-1 w-3 h-3 cursor-nesw-resize touch-none z-10" />
      <div {...handleProps('sw')} className="absolute -bottom-1 -left-1 w-3 h-3 cursor-nesw-resize touch-none z-10" />
      <div {...handleProps('se')} className="absolute -bottom-1 -right-1 w-3 h-3 cursor-nwse-resize touch-none z-10" />
    </div>
  );
}
