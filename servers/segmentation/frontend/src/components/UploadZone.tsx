'use client';

import { useRef, useState, useCallback } from 'react';
import clsx from 'clsx';
import { Icons } from './icons';

interface UploadZoneProps {
  onFile: (file: File) => void;
}

export function UploadZone({ onFile }: UploadZoneProps) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={clsx(
        'relative border-[1.5px] border-dashed rounded-xl px-6 py-10 sm:py-12 text-center cursor-pointer transition-colors mb-5',
        over ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/60'
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files) Array.from(files).forEach(onFile);
          e.target.value = '';
        }}
      />
      <Icons.Upload className="w-8 h-8 mx-auto mb-2.5 text-muted" strokeWidth={1.5} />
      <p className="text-sm font-medium mb-1">Drop images or tap to upload</p>
      <p className="text-xs text-muted">
        PNG, JPG, WebP · multiple frames supported ·{' '}
        <span className="text-accent">tap regions to extract as layers</span>
      </p>
    </div>
  );
}
