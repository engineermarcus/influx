'use client';
import { useRef, useCallback, useState } from 'react';
import clsx from 'clsx';
import { imgCoords } from '@/lib/coords';
import { Icons } from './icons';

interface FrameCanvasProps {
  src: string | null; // full data URL or null
  alt: string;
  emptyLabel: string;
  cursorStyle?: 'crosshair' | 'cell';
  busy?: boolean;
  busyLabel?: string;
  onClickPoint?: (x: number, y: number) => void;
  onBoxSelect?: (box: [number, number, number, number]) => void; // [x0, y0, x1, y1] in image px
  onPointSelect?: (x: number, y: number) => void;
  className?: string;
  fit?: 'contain' | 'cover';
}

const MIN_DRAG_SCREEN_PX = 4; // below this, treat as a click not a drag

export function FrameCanvas({
  src,
  alt,
  emptyLabel,
  cursorStyle = 'crosshair',
  busy = false,
  busyLabel = 'Working…',
  onClickPoint,
  onBoxSelect,
  onPointSelect,
  className,
  fit = 'contain',
}: FrameCanvasProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const dragStart = useRef<{ clientX: number; clientY: number } | null>(null);
  const [dragRect, setDragRect] = useState<{ left: number; top: number; w: number; h: number } | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (!imgRef.current || !onClickPoint) return;
      const { x, y } = imgCoords(e.clientX, e.clientY, imgRef.current);
      onClickPoint(x, y);
    },
    [onClickPoint]
  );

  const handleTouch = useCallback(
    (e: React.TouchEvent<HTMLImageElement>) => {
      if (!imgRef.current || !onClickPoint) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const { x, y } = imgCoords(t.clientX, t.clientY, imgRef.current);
      onClickPoint(x, y);
    },
    [onClickPoint]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLImageElement>) => {
      if (!onBoxSelect) return;
      dragStart.current = { clientX: e.clientX, clientY: e.clientY };
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [onBoxSelect]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    if (!dragStart.current) return;
    const { clientX: sx, clientY: sy } = dragStart.current;
    const left = Math.min(sx, e.clientX);
    const top = Math.min(sy, e.clientY);
    const w = Math.abs(e.clientX - sx);
    const h = Math.abs(e.clientY - sy);
    const imgRect = imgRef.current?.getBoundingClientRect();
    if (!imgRect) return;
    setDragRect({ left: left - imgRect.left, top: top - imgRect.top, w, h });
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLImageElement>) => {
      const start = dragStart.current;
      dragStart.current = null;
      if (!start || !imgRef.current || !onBoxSelect) {
        setDragRect(null);
        return;
      }
      const screenW = Math.abs(e.clientX - start.clientX);
      const screenH = Math.abs(e.clientY - start.clientY);
      if (screenW < MIN_DRAG_SCREEN_PX || screenH < MIN_DRAG_SCREEN_PX) {
        // treat as a plain click: prefer point-select (SAM point prompt) over onClickPoint
        setDragRect(null);
        if (onPointSelect) {
          const { x, y } = imgCoords(e.clientX, e.clientY, imgRef.current);
          onPointSelect(x, y);
        } else if (onClickPoint) {
          const { x, y } = imgCoords(e.clientX, e.clientY, imgRef.current);
          onClickPoint(x, y);
        }
        return;
      }
      const p1 = imgCoords(start.clientX, start.clientY, imgRef.current);
      const p2 = imgCoords(e.clientX, e.clientY, imgRef.current);
      const box: [number, number, number, number] = [
        Math.min(p1.x, p2.x),
        Math.min(p1.y, p2.y),
        Math.max(p1.x, p2.x),
        Math.max(p1.y, p2.y),
      ];
      setDragRect(null);
      onBoxSelect(box);
    },
    [onBoxSelect, onClickPoint]
  );

  const dragEnabled = !!onBoxSelect;

  return (
    <div className={clsx('relative w-full h-full bg-raised rounded-lg overflow-hidden flex items-center justify-center', className)}>
      {!src && (
        <span className="text-xs text-dim text-center px-3">{emptyLabel}</span>
      )}
      {src && (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onClick={!dragEnabled && onClickPoint ? handleClick : undefined}
          onTouchEnd={!dragEnabled && onClickPoint ? handleTouch : undefined}
          onPointerDown={dragEnabled ? handlePointerDown : undefined}
          onPointerMove={dragEnabled ? handlePointerMove : undefined}
          onPointerUp={dragEnabled ? handlePointerUp : undefined}
          className={clsx(
            'select-none transition-opacity duration-150 touch-none',
            fit === 'contain' ? 'max-w-full max-h-full object-contain' : 'w-full h-full object-cover',
            loaded ? 'opacity-100' : 'opacity-0',
            (onClickPoint || onBoxSelect) && (cursorStyle === 'crosshair' ? 'cursor-crosshair' : 'cursor-cell')
          )}
        />
      )}
      {dragRect && (
        <div
          className="absolute border-2 border-accent bg-accent/15 pointer-events-none rounded-sm"
          style={{ left: dragRect.left, top: dragRect.top, width: dragRect.w, height: dragRect.h }}
        />
      )}
      {busy && (
        <div className="absolute inset-0 bg-bg/75 flex flex-col items-center justify-center gap-2.5 rounded-lg">
          <Icons.Spinner className="w-7 h-7 text-accent animate-spin-slow" strokeWidth={2.5} />
          <span className="text-xs text-muted">{busyLabel}</span>
        </div>
      )}
    </div>
  );
}
