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
  className?: string;
  fit?: 'contain' | 'cover';
}

export function FrameCanvas({
  src,
  alt,
  emptyLabel,
  cursorStyle = 'crosshair',
  busy = false,
  busyLabel = 'Working…',
  onClickPoint,
  className,
  fit = 'contain',
}: FrameCanvasProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

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
          onClick={onClickPoint ? handleClick : undefined}
          onTouchEnd={onClickPoint ? handleTouch : undefined}
          className={clsx(
            'select-none transition-opacity duration-150',
            fit === 'contain' ? 'max-w-full max-h-full object-contain' : 'w-full h-full object-cover',
            loaded ? 'opacity-100' : 'opacity-0',
            onClickPoint && (cursorStyle === 'crosshair' ? 'cursor-crosshair' : 'cursor-cell')
          )}
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
