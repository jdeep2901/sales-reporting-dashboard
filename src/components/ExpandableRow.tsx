import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ExpandableRowProps {
  row: React.ReactNode;
  panel: React.ReactNode;
  riskBorderColor?: string;
  className?: string;
}

export function ExpandableRow({ row, panel, riskBorderColor, className }: ExpandableRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('relative', className)}>
      {riskBorderColor && (
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-sm"
          style={{ backgroundColor: riskBorderColor }}
        />
      )}
      <div
        className="pl-3 cursor-pointer hover:bg-bg-hover transition-colors"
        onClick={() => setOpen((o) => !o)}
        role="button"
        aria-expanded={open}
      >
        {row}
      </div>
      {open && (
        <div
          className="pl-3 bg-bg-surface"
          style={{ borderTop: '0.5px solid var(--border-hairline)' }}
        >
          {panel}
        </div>
      )}
    </div>
  );
}
