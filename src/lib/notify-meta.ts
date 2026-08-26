import { EVENT_META } from './calc/vcp';
import { INV_EVENT_META } from './calc/investments';
import type { Tower } from './auth/types';

export interface EventMeta {
  label: string;
  clr: string;
}

const FALLBACK: EventMeta = { label: 'Update', clr: '#6A6A78' };

/** Same event key can mean different things per tower (e.g. VCP's `approve` is
 * "Baseline approved", INV's is "Approved") — resolve by (tower, event), never event alone. */
export function eventMeta(tower: Tower, event: string): EventMeta {
  const table = tower === 'vcp' ? (EVENT_META as Record<string, EventMeta>) : (INV_EVENT_META as Record<string, EventMeta>);
  return table[event] ?? FALLBACK;
}
