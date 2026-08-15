'use client';

import { Icons } from './icons';

interface ActionBarProps {
  layerCount: number;
  hasRecomposed: boolean;
  onRecompose: () => void;
  onDownload: () => void;
  onClear: () => void;
  onReset: () => void;
  showReset: boolean;
}

export function ActionBar({
  layerCount,
  hasRecomposed,
  onRecompose,
  onDownload,
  onClear,
  onReset,
  showReset,
}: ActionBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      <button
        onClick={onRecompose}
        disabled={layerCount === 0}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-bg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-85 active:scale-[0.97] transition-all"
      >
        <Icons.Layers className="w-3.5 h-3.5" />
        Recompose
      </button>

      <button
        onClick={onDownload}
        disabled={!hasRecomposed}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-raised border border-border text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-hover active:scale-[0.97] transition-all"
      >
        <Icons.Download className="w-3.5 h-3.5" />
        Download
      </button>

      <button
        onClick={onClear}
        disabled={layerCount === 0}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-raised border border-border text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-hover active:scale-[0.97] transition-all"
      >
        <Icons.Trash className="w-3.5 h-3.5" />
        Clear layers
      </button>

      {showReset && (
        <button
          onClick={onReset}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-transparent border border-danger/30 text-danger text-xs font-medium hover:bg-danger/10 active:scale-[0.97] transition-all"
        >
          <Icons.Reset className="w-3.5 h-3.5" />
          New image
        </button>
      )}

      <span className="ml-auto text-xs text-muted font-mono">
        <span className="text-accent font-semibold">{layerCount}</span> layers
      </span>
    </div>
  );
}
