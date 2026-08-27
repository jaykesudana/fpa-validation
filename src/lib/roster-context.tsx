'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api-client';

export interface RosterUser {
  email: string;
  name: string;
  role: 'admin' | 'fbp';
}

interface RosterState {
  roster: RosterUser[];
  refresh: () => Promise<void>;
}

const RosterContext = createContext<RosterState | null>(null);

/**
 * Single shared source of truth for "who can I sign in as" — mounted once at
 * the root, so Dev Sign-In and the User Access page read the exact same
 * in-memory state instead of each independently fetching /api/dev/users on
 * their own schedule. The Admin Users page calls `refresh()` directly after
 * a mutation succeeds, which updates this state immediately for every
 * consumer, including Dev Sign-In — no polling, no cache headers, no event
 * bus, no timing gap to chase.
 */
export function RosterProvider({ children }: { children: ReactNode }) {
  const [roster, setRoster] = useState<RosterUser[]>([]);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ users: RosterUser[] }>('/api/dev/users');
      setRoster(r.users);
    } catch {
      setRoster([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <RosterContext.Provider value={{ roster, refresh }}>{children}</RosterContext.Provider>;
}

export function useRoster(): RosterState {
  const ctx = useContext(RosterContext);
  if (!ctx) throw new Error('useRoster must be used within RosterProvider');
  return ctx;
}
