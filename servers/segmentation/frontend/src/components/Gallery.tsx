'use client';

import { Icons } from './icons';
import { downloadDataUrl } from '@/lib/coords';

interface GalleryProps {
  layers: string[]; // base64 (no prefix)
}

export function Gallery({ layers }: GalleryProps) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2.5">
        <Icons.Layers className="w-3.5 h-3.5 text-muted" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Extracted layers
        </span>
        <span className="text-xs text-dim">({layers.length})</span>
      </div>
      {layers.length === 0 ? (
        <div className="flex items-center justify-center h-16 border border-dashed border-border rounded-lg">
          <span className="text-xs text-dim">No layers yet</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {layers.map((b64, i) => {
            const dataUrl = `data:image/png;base64,${b64}`;
            return (
              <div
                key={i}
                className="group relative w-20 h-20 sm:w-[88px] sm:h-[88px] bg-raised border border-border rounded-lg overflow-hidden flex items-center justify-center"
              >
                <span className="absolute top-1 left-1.5 text-[10px] font-mono font-semibold text-dim z-10">
                  {i + 1}
                </span>
                <img src={dataUrl} alt={`Layer ${i + 1}`} className="max-w-full max-h-full object-contain" />
                <button
                  onClick={() => downloadDataUrl(dataUrl, `layer-${i + 1}.png`)}
                  className="absolute inset-0 bg-bg/0 group-hover:bg-bg/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                  aria-label={`Download layer ${i + 1}`}
                >
                  <Icons.Download className="w-4 h-4 text-text" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
