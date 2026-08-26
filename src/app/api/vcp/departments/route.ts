import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { coverage, deptCurrentIdentified, deptGates, deptTarget, deptValidatedTotal } from '@/lib/calc/vcp';
import { resolveFiscalYear } from '@/lib/fiscal-year';
import { loadDepartmentsForCalc } from '@/lib/vcp/load-department';

interface DeptRow {
  id: string;
  name: string;
  l1: string;
  summary_group: string;
}

// GET /api/vcp/departments?fy=… — 05-API.md. One entry per in-scope department.
export async function GET(req: Request) {
  try {
    const { deptIds } = await requireScope({ tower: 'vcp' });

    const url = new URL(req.url);
    const fy = await resolveFiscalYear(url.searchParams.get('fy'));
    if (!fy) return NextResponse.json({ error: 'No current fiscal year configured' }, { status: 400 });

    if (deptIds.length === 0) return NextResponse.json({ fiscalYear: fy, departments: [] });

    const sql = db();
    const deptRows = (await sql`
      select id, name, l1, summary_group from departments
      where active = true and id = any(${deptIds}::text[])
      order by sort_order
    `) as DeptRow[];

    const calcDepts = await loadDepartmentsForCalc(fy, deptRows.map((d) => d.id));

    const departments = deptRows.map((d) => {
      const cd = calcDepts.get(d.id)!;
      const target = deptTarget(cd);
      const identified = deptCurrentIdentified(cd);
      const delivered = deptValidatedTotal(cd);
      return {
        deptId: d.id,
        name: d.name,
        l1: d.l1,
        summaryGroup: d.summary_group,
        gates: deptGates(cd),
        target,
        identified,
        delivered,
        coverage: coverage(target, delivered),
      };
    });

    return NextResponse.json({ fiscalYear: fy, departments });
  } catch (err) {
    return toErrorResponse(err);
  }
}
