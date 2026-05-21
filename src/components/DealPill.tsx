import { cn } from '@/lib/utils';
import { IconAlertTriangle, IconCheck, IconClock, IconMinus } from '@tabler/icons-react';

type RiskLevel = 'high' | 'medium' | 'low' | 'none';

interface DealPillProps {
  risk: RiskLevel;
  label?: string;
  className?: string;
}

const config: Record<RiskLevel, { icon: React.ReactNode; bg: string; text: string; defaultLabel: string }> = {
  high: {
    icon: <IconAlertTriangle size={10} />,
    bg: 'bg-status-red-bg',
    text: 'text-status-red-text',
    defaultLabel: 'At risk',
  },
  medium: {
    icon: <IconClock size={10} />,
    bg: 'bg-status-amber-bg',
    text: 'text-status-amber-text',
    defaultLabel: 'Watch',
  },
  low: {
    icon: <IconCheck size={10} />,
    bg: 'bg-status-green-bg',
    text: 'text-status-green-text',
    defaultLabel: 'On track',
  },
  none: {
    icon: <IconMinus size={10} />,
    bg: 'bg-bg-surface',
    text: 'text-text-secondary',
    defaultLabel: '—',
  },
};

export function DealPill({ risk, label, className }: DealPillProps) {
  const { icon, bg, text, defaultLabel } = config[risk];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-sm px-[7px] py-[2px] text-11 font-medium',
        bg,
        text,
        className,
      )}
    >
      {icon}
      {label ?? defaultLabel}
    </span>
  );
}
