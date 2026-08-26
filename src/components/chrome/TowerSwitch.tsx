'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TOWERS = [
  { href: '/', key: 'summary', title: 'Summary', meta: 'Leadership rollup' },
  { href: '/vcp', key: 'vcp', title: 'Value Creation Plan', meta: 'Savings by department' },
  { href: '/investments', key: 'inv', title: 'Investment Requests', meta: 'FY pool & requests' },
] as const;

export function TowerSwitch() {
  const pathname = usePathname();

  return (
    <div className="tower-switch">
      <div className="tower-switch__label">Tower</div>
      {TOWERS.map((t) => {
        const isActive = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
        return (
          <Link key={t.key} href={t.href} className={isActive ? 'tower-switch__btn is-active' : 'tower-switch__btn'}>
            <p className="tower-switch__btn-title">{t.title}</p>
            <p className="tower-switch__btn-meta">{t.meta}</p>
          </Link>
        );
      })}
    </div>
  );
}
