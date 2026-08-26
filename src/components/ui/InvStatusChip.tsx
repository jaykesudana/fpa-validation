import { INV_STATUS, type ReqStatus } from '@/lib/calc/investments';
import { Chip } from './Chip';

export function InvStatusChip({ status }: { status: ReqStatus }) {
  const meta = INV_STATUS[status];
  return <Chip label={meta.label} text={meta.clr} bg={meta.bg} />;
}
