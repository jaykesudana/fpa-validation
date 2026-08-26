'use client';

import { TopBar } from './TopBar';
import { TowerSwitch } from './TowerSwitch';

export function PageHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <>
      <TopBar eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <TowerSwitch />
    </>
  );
}
