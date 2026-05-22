import { useState } from 'react';

export function useSessionState<T>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });
  const set = (v: T) => {
    setState(v);
    try { sessionStorage.setItem(key, JSON.stringify(v)); } catch {}
  };
  return [state, set];
}
