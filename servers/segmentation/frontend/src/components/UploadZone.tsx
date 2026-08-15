'use client';

import { useRef, useState, useCallback } from 'react';
import clsx from 'clsx';
import { Icons } from './icons';

interface UploadZoneProps {
  onFile: (file: File) => void;
  progress: number | null; // 0-100, or null when idle
}

export function UploadZone({ onFile, progress }: UploadZoneProps) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = progress !== null;

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
    <div className="flex items-center justify-center min-h-[60vh]">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!uploading) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={uploading ? undefined : handleDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={clsx(
          'relative w-56 h-56 sm:w-64 sm:h-64 border-[1.5px] border-dashed rounded-2xl flex flex-col items-center justify-center gap-2.5 text-center px-5 transition-colors',
          uploading ? 'cursor-default' : 'cursor-pointer',
          over ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/60'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const files = e.target.files;
            if (files) Array.from(files).forEach(onFile);
            e.target.value = '';
          }}
        />

        {!uploading && (
          <>
            <Icons.Upload className="w-7 h-7 text-muted" strokeWidth={1.5} />
            <p className="text-sm font-medium">Drop image or tap</p>
            <p className="text-[11px] text-muted leading-snug">
              PNG, JPG, WebP
              <br />
              <span className="text-accent">tap regions to extract layers</span>
            </p>
          </>
        )}

        {uploading && (
          <>
            <Icons.Spinner className="w-6 h-6 text-accent animate-spin-slow" strokeWidth={2.5} />
            <p className="text-sm font-medium font-mono">{progress}%</p>
            <div className="w-3/4 h-1.5 bg-raised rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[11px] text-muted">Uploading…</p>
          </>
        )}
      </div>
    </div>
  );
}