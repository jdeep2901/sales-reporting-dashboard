import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { ACTIVE_SELLERS } from '@/lib/vpCompute';

export const SELLER_OPTIONS = ['Overall', ...ACTIVE_SELLERS];

interface SellerContextValue {
  seller: string;
  setSeller: (s: string) => void;
}

const SellerContext = createContext<SellerContextValue>({
  seller: 'Overall',
  setSeller: () => {},
});

export function SellerProvider({ children }: { children: ReactNode }) {
  const [seller, setSeller] = useState('Overall');
  return (
    <SellerContext.Provider value={{ seller, setSeller }}>
      {children}
    </SellerContext.Provider>
  );
}

export function useSeller() {
  return useContext(SellerContext);
}
