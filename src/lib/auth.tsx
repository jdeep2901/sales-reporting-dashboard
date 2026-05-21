import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';

interface Credentials {
  username: string;
  password: string;
}

interface AuthContextValue {
  credentials: Credentials | null;
  login: (username: string, password: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'mathco_dashboard_creds';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<Credentials | null>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Credentials) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (credentials) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [credentials]);

  const login = (username: string, password: string) => {
    setCredentials({ username: username.trim().toLowerCase(), password });
  };

  const logout = () => setCredentials(null);

  return (
    <AuthContext.Provider value={{ credentials, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
