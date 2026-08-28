// 02-WORKBOOKS.md §5 "Header aliasing". The doc lists patterns per field; this
// flattens them into ONE ordered list per gate and takes the first match for
// a given header. The order here is deliberately by SPECIFICITY, not the
// doc's display order: compound fields (Status Update, Validated Amount,
// Validated Date, Dept #, EE ID) are tried before their broader,
// single-word cousins (Status, Identified amount, Target date, Category).
//
// This matters concretely for one pair: "Status Update" vs "Status". The
// doc's own Status patterns are `/^status$/i`, `/status(?! ?update)/i`,
// `/status/i` — the third is a bare catch-all that WOULD match a literal
// "Status Update" header too. Trying the Status Update field's own pattern
// first (before ever falling through to Status's bare catch-all) is what
// actually delivers the disambiguation the negative lookahead is clearly
// there for; testing fields in the doc's table order would let "Status"
// rule 3 wrongly claim a "Status Update" column.
//
// The Gate 2 / Gate 3 variants of "Target date" and "Identified amount"
// differ only in anchoring, because Gate 3 also carries "Validated Date" /
// "Validated Amount" — the anchored forms (`/^date/i`, `/^amount/i`) stop
// those columns from colliding.

export type FieldKey =
  | 'initiative'
  | 'deptNo'
  | 'name'
  | 'category'
  | 'eeId'
  | 'country'
  | 'frequency'
  | 'targetDate'
  | 'identifiedAmount'
  | 'notes'
  | 'status'
  | 'validatedAmount'
  | 'validatedDate'
  | 'statusUpdate'
  | 'baselineRowId';

interface AliasRule {
  field: FieldKey;
  pattern: RegExp;
}

export function buildAliasRules(gate: 2 | 3): AliasRule[] {
  return [
    { field: 'baselineRowId', pattern: /row ?id/i },
    { field: 'statusUpdate', pattern: /status ?update/i },
    { field: 'validatedAmount', pattern: /validated ?amount/i },
    { field: 'validatedAmount', pattern: /validated ?\(/i },
    { field: 'validatedAmount', pattern: /^validated$/i },
    { field: 'validatedAmount', pattern: /actual/i },
    { field: 'validatedDate', pattern: /validated ?date/i },
    { field: 'validatedDate', pattern: /val.*date/i },
    { field: 'deptNo', pattern: /dept ?#/i },
    { field: 'deptNo', pattern: /dept ?(no|num)/i },
    { field: 'deptNo', pattern: /department ?#/i },
    { field: 'eeId', pattern: /ee ?id/i },
    { field: 'eeId', pattern: /employee ?id/i },
    { field: 'targetDate', pattern: /target ?date/i },
    { field: 'targetDate', pattern: gate === 2 ? /date/i : /^date/i },
    { field: 'identifiedAmount', pattern: /identified/i },
    { field: 'identifiedAmount', pattern: gate === 2 ? /amount/i : /^amount/i },
    { field: 'notes', pattern: /notes?/i },
    { field: 'notes', pattern: /comment/i },
    { field: 'frequency', pattern: /frequency/i },
    { field: 'frequency', pattern: /freq/i },
    { field: 'country', pattern: /country/i },
    { field: 'category', pattern: /category/i },
    { field: 'category', pattern: /^cat/i },
    { field: 'status', pattern: /^status$/i },
    { field: 'status', pattern: /status(?! ?update)/i },
    { field: 'status', pattern: /status/i },
    { field: 'name', pattern: /line ?item/i },
    { field: 'name', pattern: /^name$/i },
    { field: 'name', pattern: /description/i },
    { field: 'initiative', pattern: /initiative/i },
  ];
}

export function resolveHeader(header: string, gate: 2 | 3): FieldKey | null {
  const rules = buildAliasRules(gate);
  for (const rule of rules) {
    if (rule.pattern.test(header)) return rule.field;
  }
  return null;
}

/** Maps each column INDEX to the field it resolves to. A field already
 * claimed by an earlier column is never reassigned to a later duplicate. */
export function mapHeaders(headers: readonly string[], gate: 2 | 3): Record<number, FieldKey> {
  const map: Record<number, FieldKey> = {};
  const claimed = new Set<FieldKey>();
  headers.forEach((h, idx) => {
    const field = resolveHeader(h.trim(), gate);
    if (field && !claimed.has(field)) {
      map[idx] = field;
      claimed.add(field);
    }
  });
  return map;
}
