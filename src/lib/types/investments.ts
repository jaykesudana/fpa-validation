import type { ReqStatus } from '@/lib/calc/investments';

export interface StatusMeta {
  value: ReqStatus;
  label: string;
  clr: string;
  bg: string;
  stage: number;
  counts: string;
}

export interface InvRequestListItem {
  id: string;
  ref: string;
  title: string;
  dept: string;
  deptId: string;
  initiative: string | null;
  type: string;
  country: string;
  region: string;
  amount: number;
  approvedAmount: number | null;
  status: StatusMeta;
  lastAction: { at: string | null; by: string };
}

export interface InvRequestDetail {
  id: string;
  ref: string;
  title: string;
  deptId: string;
  dept: string;
  initiativeId: string | null;
  initiative: string | null;
  type: string;
  country: string;
  region: string;
  amount: number;
  approvedAmount: number | null;
  phasing: { Q1: number; Q2: number; Q3: number; Q4: number };
  expectedReturn: number;
  payback: string | null;
  sponsor: string | null;
  execSponsor: string | null;
  businessCase: string | null;
  risk: string | null;
  status: StatusMeta;
  submittedByName: string | null;
  submittedAt: string | null;
  screenedByName: string | null;
  screenedAt: string | null;
  screenNote: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  attachments: { id: string; fileName: string; sizeBytes: number | null; uploadedAt: string }[];
  log: { at: string; actorName: string; action: string; note: string | null }[];
}

export interface BucketResponse {
  fiscal: string;
  total: number;
  reserve: number;
  available: number;
  approved: number;
  pending: number;
  rejected: number;
  draft: number;
  remaining: number;
  unallocated: number;
  overcommitted: boolean;
  count: number;
  approvedCount: number;
  pendingCount: number;
  locked: boolean;
  setByName: string | null;
  setAt: string | null;
  note: string | null;
}
