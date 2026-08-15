'use client';

import clsx from 'clsx';
import type { FrameKey } from '@/lib/types';
import { FRAME_LABELS } from '@/lib/types';

interface TabBarProps {
  active: FrameKey;
  onChange: (key: FrameKey) => void;
  layerCount: number;
}

const ORDER: FrameKey[] = ['input', 'coverage', 'recomposed'];

export function TabBar({ active, onChange, layerCount }: TabBarProps) {
  return (
    <div className="flex sm:hidden gap-1.5 mb-3 bg-surface border border-border rounded-lg p-1">
      {ORDER.map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={clsx(
            'flex-1 py-2 rounded-md text-xs font-medium transition-colors relative',
            active === key ? 'bg-accent text-bg' : 'text-muted hover:text-text'
          )}
        >
          {FRAME_LABELS[key]}
          {key === 'recomposed' && layerCount > 0 && (
            <span className="ml-1 text-[10px] opacity-70">({layerCount})</span>
          )}
        </button>
      ))}
    </div>
  );
}
