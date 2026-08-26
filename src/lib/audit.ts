import { db } from './db';
import type { AppUser } from './auth/types';

export interface AuditEntryInput {
  actor: AppUser;
  tower: 'vcp' | 'inv' | 'admin';
  entityType: string;
  entityId?: string | null;
  departmentId?: string | null;
  action: string;
  fromState?: string | null;
  toState?: string | null;
  note?: string | null;
  payload?: Record<string, unknown>;
}

/** 01-DOMAIN-AND-ROLES.md §6: every mutation writes exactly one immutable audit row. */
export async function insertAudit(entry: AuditEntryInput): Promise<void> {
  const sql = db();
  await sql`
    insert into audit_log (
      actor_user_id, actor_name, actor_role, tower, entity_type, entity_id,
      department_id, action, from_state, to_state, note, payload
    ) values (
      ${entry.actor.id}, ${entry.actor.name}, ${entry.actor.role}, ${entry.tower},
      ${entry.entityType}, ${entry.entityId ?? null}, ${entry.departmentId ?? null},
      ${entry.action}, ${entry.fromState ?? null}, ${entry.toState ?? null},
      ${entry.note ?? null}, ${JSON.stringify(entry.payload ?? {})}::jsonb
    )
  `;
}
