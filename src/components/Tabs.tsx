import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface TabItem {
  label: string;
  to: string;
}

interface TabsProps {
  tabs: TabItem[];
  className?: string;
}

export function Tabs({ tabs, className }: TabsProps) {
  return (
    <nav
      className={cn('flex gap-0 border-b overflow-x-auto', className)}
      style={{ borderColor: 'var(--border-hairline)' }}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) =>
            cn(
              'px-4 py-3 text-13 whitespace-nowrap transition-colors shrink-0',
              isActive
                ? 'text-text-primary font-medium border-b-[1.5px] border-b-[#0A0A0A] -mb-px'
                : 'text-text-secondary hover:text-text-primary',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
