'use client';

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
        <NotificationBell />
      </div>
    </div>
  );
}
