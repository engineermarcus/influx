'use client';
import { Icons } from './icons';

interface RigLayerPickerProps {
  layers: string[]; // base64, no data: prefix
  selected: Set<number>;
  onToggle: (i: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onConfirm: () => void;
}

export function RigLayerPicker({
  layers,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  onConfirm,
}: RigLayerPickerProps) {
  return (
    <div className="mb-6 border border-border rounded-xl p-3.5 bg-surface">
      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Choose parts to rig
        </span>
        <span className="text-xs text-dim">
          ({selected.size}/{layers.length})
        </span>
        <button onClick={onSelectAll} className="ml-auto text-xs text-muted hover:text-text transition-colors">
          All
        </button>
        <button onClick={onSelectNone} className="text-xs text-muted hover:text-text transition-colors">
          None
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {layers.map((b64, i) => {
          const isOn = selected.has(i);
          return (
            <button
              key={i}
              onClick={() => onToggle(i)}
              className={
                'relative w-16 h-16 border rounded-lg overflow-hidden flex items-center justify-center transition-all ' +
                (isOn ? 'border-accent' : 'border-border opacity-35 hover:opacity-70')
              }
            >
              <img
                src={`data:image/png;base64,${b64}`}
                alt={`Layer ${i + 1}`}
                className="max-w-full max-h-full object-contain"
              />
              <span className="absolute top-0.5 left-1 text-[10px] font-mono font-semibold text-dim">{i + 1}</span>
              {isOn && <Icons.Eye className="absolute bottom-0.5 right-0.5 w-3 h-3 text-accent" />}
            </button>
          );
        })}
      </div>
      <button
        onClick={onConfirm}
        disabled={selected.size === 0}
        className="w-full py-2.5 rounded-lg border border-accent/40 text-accent text-xs font-semibold hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Rig {selected.size} part{selected.size === 1 ? '' : 's'} →
      </button>
    </div>
  );
}
