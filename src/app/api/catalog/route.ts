import { NextResponse } from 'next/server';
import { INV_TYPES, QUARTERS, COUNTRIES as INV_COUNTRIES_BY_REGION } from '@/lib/calc/investments';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { db } from '@/lib/db';
import { CATEGORIES, COUNTRIES as WORKBOOK_COUNTRIES, FREQUENCIES, LINE_STATUSES } from '@/lib/workbook/constants';

// GET /api/catalog — 05-API.md. Departments, VCP/investment initiatives,
// categories, frequencies, line statuses, investment types, quarters.
//
// Two DIFFERENT country lists exist in this domain and must not be confused:
// the VCP workbook's flat 50-country list (02-WORKBOOKS.md §4), and the
// investment tower's region-grouped list (01-DOMAIN-AND-ROLES.md §4). Same
// export name "COUNTRIES" in both source modules — exposed here under
// distinct keys so a client never accidentally wires the wrong one in.
export async function GET() {
  try {
    await requireScope();
    const sql = db();

    const [departments, vcpInitiatives, invInitiatives] = await Promise.all([
      sql`select id, name, l1, summary_group as "summaryGroup" from departments where active = true order by sort_order` as Promise<
        { id: string; name: string; l1: string; summaryGroup: string }[]
      >,
      sql`select id, name from vcp_initiatives where active = true order by sort_order` as Promise<{ id: string; name: string }[]>,
      sql`select id, name from inv_initiatives where active = true order by sort_order` as Promise<{ id: string; name: string }[]>,
    ]);

    return NextResponse.json({
      departments,
      vcpInitiatives,
      invInitiatives,
      categories: CATEGORIES,
      workbookCountries: WORKBOOK_COUNTRIES,
      investmentCountriesByRegion: INV_COUNTRIES_BY_REGION,
      frequencies: FREQUENCIES,
      lineStatuses: LINE_STATUSES,
      invTypes: INV_TYPES,
      quarters: QUARTERS,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
