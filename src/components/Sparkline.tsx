import { cn } from '@/lib/utils';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}

export function Sparkline({ values, width = 60, height = 20, className }: SparklineProps) {
  if (!values || values.length < 2) {
    return (
      <svg width={width} height={height} className={className}>
        <line
          x1={2} y1={height / 2} x2={width - 2} y2={height / 2}
          stroke="var(--text-tertiary)"
          strokeWidth={1.5}
          strokeDasharray="3 2"
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * w;
    const y = pad + (1 - (v - min) / range) * h;
    return `${x},${y}`;
  });

  const first = values[0];
  const last = values[values.length - 1];
  const color =
    last > first ? 'var(--status-green)' : last < first ? 'var(--status-red)' : 'var(--text-tertiary)';

  return (
    <svg width={width} height={height} className={cn('overflow-visible', className)}>
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
