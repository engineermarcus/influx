'use client';

import { useEffect } from 'react';
import { FrameCanvas } from './FrameCanvas';
import { FloatingHud } from './FloatingHud';
import { Icons } from './icons';
import type { FrameKey } from '@/lib/types';
import { FRAME_LABELS, FRAME_HINTS } from '@/lib/types';

interface FullscreenFrameProps {
  frameKey: Extract<FrameKey, 'input' | 'coverage'>;
  src: string | null;
  busy?: boolean;
  onClickPoint: (x: number, y: number) => void;
  onExit: () => void;
  hudSrc: string | null;
}

export function FullscreenFrame({ frameKey, src, busy, onClickPoint, onExit, hudSrc }: FullscreenFrameProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onExit]);

  return (
    <div className="fixed inset-0 z-[60] bg-bg flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          {FRAME_LABELS[frameKey]}
        </span>
        <span className="text-xs text-dim hidden sm:inline">{FRAME_HINTS[frameKey]}</span>
        <button
          onClick={onExit}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-raised border border-border text-xs hover:bg-hover transition-colors"
        >
          <Icons.ExitFullscreen className="w-3.5 h-3.5" />
          Exit fullscreen
        </button>
      </div>
      <div className="flex-1 p-3 sm:p-6 min-h-0">
        <FrameCanvas
          src={src}
          alt={FRAME_LABELS[frameKey]}
          emptyLabel="Nothing here yet"
          busy={busy}
          busyLabel="Segmenting…"
          onClickPoint={onClickPoint}
        />
      </div>
      <FloatingHud src={hudSrc} label={FRAME_LABELS.recomposed} onClose={onExit} />
    </div>
  );
}
