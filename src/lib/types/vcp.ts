import type { GateState } from '@/lib/calc/vcp';

export interface VcpInitiativeTarget {
  initiativeId: string;
  name: string;
  targetCents: number;
  locked: boolean;
  setByName: string | null;
  setAt: string | null;
}

export interface VcpLineRow {
  rowNo: number;
  initiativeId: string;
  initiativeName: string;
  deptNo: string;
  name: string;
  category: string;
  eeId: string;
  country: string;
  frequency: string;
  targetDate: string;
  identifiedCents: number;
  notes: string;
}

export interface VcpValidationLineRow extends VcpLineRow {
  status: string;
  validatedCents: number;
  validatedDate: string;
  statusUpdate: string;
}

export interface VcpEvidence {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  uploadedAt: string;
}

export interface VcpBaseline {
  id: string;
  fileName: string;
  rowCount: number;
  state: string;
  uploadedByName: string;
  uploadedAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectNote: string | null;
  rows: VcpLineRow[];
  evidence: VcpEvidence[];
}

export interface VcpValidationVersion {
  id: string;
  version: number;
  fileName: string;
  rowCount: number;
  validatedSubtotalCents: number;
  state: string;
  uploadedByName: string;
  uploadedAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  note: string | null;
  rows: VcpValidationLineRow[];
}

export interface VcpAuditEntry {
  at: string;
  actorName: string;
  action: string;
  fromState: string | null;
  toState: string | null;
  note: string | null;
}

export interface VcpDeptDetail {
  deptId: string;
  name: string;
  l1: string;
  summaryGroup: string;
  gates: { g1: GateState; g2: GateState; g3: GateState };
  target: number;
  identified: number;
  currentIdentified: number;
  delivered: number;
  coverage: number;
  initiatives: VcpInitiativeTarget[];
  baseline: VcpBaseline | null;
  validations: VcpValidationVersion[];
  audit: VcpAuditEntry[];
  viewerRole: 'admin' | 'fbp';
}
