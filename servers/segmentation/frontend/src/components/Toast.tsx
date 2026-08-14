'use client';

import clsx from 'clsx';

interface ToastProps {
  message: string;
  isError: boolean;
  visible: boolean;
}

export function Toast({ message, isError, visible }: ToastProps) {
  return (
    <div
      className={clsx(
        'fixed bottom-5 right-1/2 translate-x-1/2 sm:right-5 sm:translate-x-0 z-[80] px-4 py-2.5 rounded-lg border text-xs font-medium pointer-events-none transition-all duration-200 max-w-[90vw]',
        isError ? 'border-danger text-danger bg-raised' : 'border-border text-text bg-raised',
        visible ? 'opacity-100 translate-y-0 animate-toast-in' : 'opacity-0 translate-y-2'
      )}
    >
      {message}
    </div>
  );
}
