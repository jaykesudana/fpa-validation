import { statusMeta } from '@/lib/calc/vcp';
import { Chip } from './Chip';

const BG_BY_LABEL: Record<string, string> = {
  'On track': 'rgba(98,139,72,0.14)',
  'At risk': 'rgba(246,111,19,0.14)',
  Behind: 'rgba(179,0,27,0.10)',
};

export function CoverageChip({ targetCents, deliveredCents }: { targetCents: number; deliveredCents: number }) {
  const meta = statusMeta(targetCents, deliveredCents);
  return <Chip label={meta.label} text={meta.clr} bg={BG_BY_LABEL[meta.label] ?? 'transparent'} />;
}
