import { gateColors, type GateState } from '@/lib/calc/vcp';
import { Chip } from './Chip';

export function GateChip({ state }: { state: GateState }) {
  const meta = gateColors[state];
  return <Chip label={meta.label} text={meta.text} bg={meta.bg} />;
}
