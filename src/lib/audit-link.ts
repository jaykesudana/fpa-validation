export interface AuditLinkableEntry {
  tower: string;
  entityType: string;
  entityId: string | null;
  departmentId: string | null;
}

/**
 * Maps an audit entry back to the page the action actually happened on.
 * Verified against the real audit_log inserts (grep across src/app/api),
 * not assumed: `request.*` and `attachment.upload` both write entity_type
 * 'request' with entity_id = the request's own id, so those link straight
 * to the request detail page. `attachment.download` writes entity_type
 * 'attachment' with entity_id = the attachment's id (not a request id) —
 * that one falls through to the general Investments link since there's no
 * request id to target directly. Every VCP entity type (target/upload/
 * validation) always carries department_id, so those link to the
 * department detail page.
 */
export function auditLink(e: AuditLinkableEntry): { href: string; label: string } | null {
  if (e.tower === 'inv' && e.entityType === 'request' && e.entityId) {
    return { href: `/investments/${e.entityId}`, label: 'Open request' };
  }
  if (e.tower === 'inv') {
    return { href: '/investments', label: 'Open Investment Requests' };
  }
  if (e.tower === 'vcp' && e.departmentId) {
    return { href: `/vcp/${e.departmentId}`, label: 'Open department' };
  }
  return null;
}
