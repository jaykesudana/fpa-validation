'use client';

import { History } from 'lucide-react';
import Link from 'next/link';
import { DevSignIn } from './DevSignIn';
import { NotificationBell } from './NotificationBell';

export function TopBar({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="top-bar">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="top-bar__title">{title}</h1>
        {subtitle && <p className="top-bar__subtitle">{subtitle}</p>}
      </div>
      <div className="top-bar__right">
        <DevSignIn />
        <Link href="/audit" className="bell-btn" aria-label="Audit log" title="Audit log">
          <History size={18} strokeWidth={1.75} />
        </Link>
        <NotificationBell />
      </div>
    </div>
  );
}
