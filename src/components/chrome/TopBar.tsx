'use client';

import { History, Users } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/lib/session-context';
import { DevSignIn } from './DevSignIn';
import { NotificationBell } from './NotificationBell';

export function TopBar({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  const { me } = useSession();
  const isAdmin = me?.user.role === 'admin';

  return (
    <div className="top-bar">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="top-bar__title">{title}</h1>
        {subtitle && <p className="top-bar__subtitle">{subtitle}</p>}
      </div>
      <div className="top-bar__right">
        <DevSignIn />
        {isAdmin && (
          <Link href="/admin/users" className="bell-btn" aria-label="User access" title="User access">
            <Users size={18} strokeWidth={1.75} />
          </Link>
        )}
        <Link href="/audit" className="bell-btn" aria-label="Audit log" title="Audit log">
          <History size={18} strokeWidth={1.75} />
        </Link>
        <NotificationBell />
      </div>
    </div>
  );
}
