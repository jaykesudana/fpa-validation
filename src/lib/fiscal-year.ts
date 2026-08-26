import { db } from './db';

export async function resolveFiscalYear(requested: string | null): Promise<string | null> {
  if (requested) return requested;
  const sql = db();
  const rows = (await sql`select id from fiscal_years where is_current = true limit 1`) as { id: string }[];
  return rows[0]?.id ?? null;
}
