import { Icons } from './icons';

export function Header() {
  return (
    <header className="flex items-center gap-3 px-4 sm:px-7 py-3.5 border-b border-border bg-surface shrink-0">
      <div className="w-7 h-7 rounded-md bg-gradient-to-br from-accent to-accent2 flex items-center justify-center shrink-0">
        <Icons.Logo className="w-4 h-4 text-bg" strokeWidth={2.5} />
      </div>
      <h1 className="text-sm font-semibold tracking-tight">Influx Segmentation</h1>
      <span className="text-xs text-muted hidden sm:inline">SAM · click to extract layers</span>
    </header>
  );
}
