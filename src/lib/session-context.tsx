'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api-client';

export interface MeResponse {
  user: { id: string; name: string; email: string; role: 'admin' | 'fbp' };
  displayName: string;
  access: { vcp: string[]; inv: string[] };
  fiscalYear: { id: string; label: string } | null;
  unread: { vcp: number; inv: number };
}

interface SessionState {
  me: MeResponse | null;
  loading: boolean;
  signedIn: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMe(await api.get<MeResponse>('/api/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <SessionContext.Provider value={{ me, loading, signedIn: me != null, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
