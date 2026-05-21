import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  subColor?: 'red' | 'amber' | 'green' | 'muted';
  className?: string;
}

const subColorMap = {
  red: 'text-status-red',
  amber: 'text-status-amber',
  green: 'text-status-green',
  muted: 'text-text-secondary',
};

export function KpiCard({ label, value, sub, subColor = 'muted', className }: KpiCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col justify-center px-[14px] py-3 bg-bg-surface rounded-md',
        className,
      )}
      style={{ minHeight: 80, border: '0.5px solid var(--border-hairline)' }}
    >
      <div className="text-12 text-text-secondary mb-1">{label}</div>
      <div className="text-22 font-medium tabular-nums leading-none">{value}</div>
      {sub && (
        <div className={cn('text-11 mt-1 tabular-nums', subColorMap[subColor])}>{sub}</div>
      )}
    </div>
  );
}
