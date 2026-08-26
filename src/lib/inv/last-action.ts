import { db } from '@/lib/db';

// 03-BUSINESS-RULES.md §B4: "In production, read this from the audit table
// instead" — so unlike deptGates()'s in-memory calc siblings, this reads the
// real audit_log rather than re-deriving from status stamps.
const ACTION_LABEL: Record<string, string> = {
  'request.submit': 'Submitted by',
  'request.screen': 'Screened by',
  'request.return': 'Returned by',
  'request.approve': 'Approved by',
  'request.reject': 'Rejected by',
  'request.withdraw': 'Withdrawn by',
};

export interface LastAction {
  at: string | null;
  by: string;
}

/** One DB round trip for a whole list — latest audit_log row per request id. */
export async function loadLastActions(requestIds: readonly string[]): Promise<Map<string, LastAction>> {
  const result = new Map<string, LastAction>();
  if (requestIds.length === 0) return result;

  const sql = db();
  const rows = (await sql`
    select distinct on (entity_id) entity_id, actor_name, action, at
    from audit_log
    where entity_type = 'request' and entity_id = any(${[...requestIds]}::text[])
    order by entity_id, at desc
  `) as { entity_id: string; actor_name: string; action: string; at: string }[];

  for (const row of rows) {
    const label = ACTION_LABEL[row.action] ?? row.action;
    result.set(row.entity_id, { at: row.at, by: `${label} ${row.actor_name}` });
  }
  return result;
}

export const DRAFT_LAST_ACTION: LastAction = { at: null, by: 'Draft — not submitted' };
