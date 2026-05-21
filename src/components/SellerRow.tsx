import { Sparkline } from './Sparkline';
import { DealPill } from './DealPill';
import { cn } from '@/lib/utils';

interface SellerRowProps {
  name: string;
  subLabel?: string;
  cells: React.ReactNode[];
  barRatio?: number; // 0–1 for progress bar
  risk?: 'high' | 'medium' | 'low' | 'none';
  trend?: number[]; // 8 data points
  className?: string;
}

export function SellerRow({ name, subLabel, cells, barRatio, risk, trend, className }: SellerRowProps) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className={cn('flex items-center gap-4 px-3 py-2.5', className)}>
      {/* Avatar */}
      <div
        className="shrink-0 w-7 h-7 rounded-full bg-bg-surface flex items-center justify-center text-11 font-medium text-text-secondary"
        style={{ border: '0.5px solid var(--border-hairline)' }}
      >
        {initials}
      </div>

      {/* Name + sub */}
      <div className="min-w-[120px]">
        <div className="text-13 font-medium">{name}</div>
        {subLabel && <div className="text-11 text-text-secondary mt-0.5">{subLabel}</div>}
      </div>

      {/* Numeric cells */}
      {cells.map((cell, i) => (
        <div key={i} className="tabular-nums text-13 min-w-[72px] text-right">
          {cell}
        </div>
      ))}

      {/* Progress bar */}
      {barRatio != null && (
        <div className="min-w-[80px] flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-bg-surface overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(barRatio * 100, 100)}%`,
                backgroundColor: barRatio >= 1 ? 'var(--status-green)' : barRatio >= 0.6 ? 'var(--accent)' : 'var(--status-red)',
              }}
            />
          </div>
          <span className="text-11 tabular-nums text-text-secondary">
            {(barRatio).toFixed(2)}x
          </span>
        </div>
      )}

      {/* Risk pill */}
      {risk && <DealPill risk={risk} className="shrink-0" />}

      {/* Sparkline */}
      {trend && <Sparkline values={trend} className="shrink-0" />}
    </div>
  );
}
