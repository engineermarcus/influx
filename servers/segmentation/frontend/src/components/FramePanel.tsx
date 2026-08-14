'use client';

import { FrameCanvas } from './FrameCanvas';
import { Icons } from './icons';
import type { FrameKey } from '@/lib/types';
import { FRAME_LABELS, FRAME_HINTS } from '@/lib/types';

interface FramePanelProps {
  frameKey: FrameKey;
  src: string | null;
  busy?: boolean;
  canFullscreen?: boolean;
  onExpand?: () => void;
  onClickPoint?: (x: number, y: number) => void;
  cursorStyle?: 'crosshair' | 'cell';
}

export function FramePanel({
  frameKey,
  src,
  busy,
  canFullscreen,
  onExpand,
  onClickPoint,
  cursorStyle,
}: FramePanelProps) {
  return (
    <div className="bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-2">
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
      </div>
      <div className="aspect-[4/3]">
        <FrameCanvas
          src={src}
          alt={FRAME_LABELS[frameKey]}
          emptyLabel={frameKey === 'input' ? 'Upload an image to begin' : '—'}
          busy={busy}
          onClickPoint={onClickPoint}
          cursorStyle={cursorStyle}
        />
      </div>
    </div>
  );
}
