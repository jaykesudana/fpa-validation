import { db } from './db';
import type { Tower } from './auth/types';

export interface NotifyDeptInput {
  tower: Tower;
  event: string;
  deptId: string;
  subject: string;
  body: string;
  linkKind?: string;
  linkRef?: string;
  /** Union in extra primary recipients (e.g. a request's submitter, who may
   * no longer hold a dept_access grant) alongside the department's grantees. */
  alsoNotifyUserIds?: string[];
}

async function fanOut(
  tower: Tower,
  event: string,
  subject: string,
  body: string,
  linkKind: string | undefined,
  linkRef: string | undefined,
  recipients: readonly { recipientId: string; isCc: boolean }[],
): Promise<void> {
  if (recipients.length === 0) return;
  const sql = db();
  await Promise.all(
    recipients.map(
      (r) => sql`
        insert into notifications (tower, event, recipient_id, is_cc, subject, body, link_kind, link_ref)
        values (${tower}, ${event}, ${r.recipientId}, ${r.isCc}, ${subject}, ${body}, ${linkKind ?? null}, ${linkRef ?? null})
      `,
    ),
  );
}

/**
 * 01-DOMAIN-AND-ROLES.md §7: recipients resolve through the department
 * access grants for the given tower; admins are cc'd on everything. One row
 * per recipient, so unread state is per-user. Called AFTER the mutation's
 * own transaction commits — notifications are fan-out, not part of the
 * atomic change (05-API.md: "mutate + audit in one transaction → fan out
 * notifications → return").
 */
export async function notifyDept(input: NotifyDeptInput): Promise<void> {
  const sql = db();

  const [grantees, admins] = await Promise.all([
    sql`select user_id from dept_access where department_id = ${input.deptId} and tower = ${input.tower}` as unknown as Promise<{ user_id: string }[]>,
    sql`select id from users where role = 'admin' and active = true` as unknown as Promise<{ id: string }[]>,
  ]);

  const granteeIds = new Set(grantees.map((g) => g.user_id));
  (input.alsoNotifyUserIds ?? []).forEach((id) => granteeIds.add(id));
  const adminIds = new Set(admins.map((a) => a.id));

  const recipients = [
    ...Array.from(granteeIds).map((id) => ({ recipientId: id, isCc: false })),
    ...Array.from(adminIds).filter((id) => !granteeIds.has(id)).map((id) => ({ recipientId: id, isCc: true })),
  ];
  await fanOut(input.tower, input.event, input.subject, input.body, input.linkKind, input.linkRef, recipients);
}

export interface NotifyAllPartnersInput {
  tower: Tower;
  event: string;
  subject: string;
  body: string;
  linkKind?: string;
  linkRef?: string;
}

/** For actions with no single owning department — e.g. the shared investment bucket. */
export async function notifyAllPartners(input: NotifyAllPartnersInput): Promise<void> {
  const sql = db();
  const [partners, admins] = await Promise.all([
    sql`select id from users where role = 'fbp' and active = true` as unknown as Promise<{ id: string }[]>,
    sql`select id from users where role = 'admin' and active = true` as unknown as Promise<{ id: string }[]>,
  ]);
  const partnerIds = new Set(partners.map((p) => p.id));
  const recipients = [
    ...Array.from(partnerIds).map((id) => ({ recipientId: id, isCc: false })),
    ...admins.filter((a) => !partnerIds.has(a.id)).map((a) => ({ recipientId: a.id, isCc: true })),
  ];
  await fanOut(input.tower, input.event, input.subject, input.body, input.linkKind, input.linkRef, recipients);
}

export interface NotifyAdminsInput {
  tower: Tower;
  event: string;
  subject: string;
  body: string;
  linkKind?: string;
  linkRef?: string;
  ccUserIds?: string[];
}

/** Admins as primary recipients, with an explicit cc list (e.g. a request's submitter). */
export async function notifyAdmins(input: NotifyAdminsInput): Promise<void> {
  const sql = db();
  const admins = (await sql`select id from users where role = 'admin' and active = true`) as { id: string }[];
  const adminIds = new Set(admins.map((a) => a.id));
  const recipients = [
    ...admins.map((a) => ({ recipientId: a.id, isCc: false })),
    ...(input.ccUserIds ?? []).filter((id) => !adminIds.has(id)).map((id) => ({ recipientId: id, isCc: true })),
  ];
  await fanOut(input.tower, input.event, input.subject, input.body, input.linkKind, input.linkRef, recipients);
}
