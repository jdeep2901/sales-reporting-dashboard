import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { INDUSTRIES } from '@/lib/vpCompute';

// Global industry filter shared across views ('Overall' = all industries).
export const INDUSTRY_OPTIONS = ['Overall', ...INDUSTRIES];

interface IndustryContextValue {
  industry: string;
  setIndustry: (s: string) => void;
}

const IndustryContext = createContext<IndustryContextValue>({
  industry: 'Overall',
  setIndustry: () => {},
});

export function IndustryProvider({ children }: { children: ReactNode }) {
  const [industry, setIndustry] = useState('Overall');
  return (
    <IndustryContext.Provider value={{ industry, setIndustry }}>
      {children}
    </IndustryContext.Provider>
  );
}

export function useIndustry() {
  return useContext(IndustryContext);
}
