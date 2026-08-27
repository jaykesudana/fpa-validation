'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/chrome/PageHeader';
import { CoverageChip } from '@/components/ui/CoverageChip';
import { AuditTrail } from '@/components/ui/AuditTrail';
import { Gate1Panel } from '@/components/vcp/Gate1Panel';
import { Gate2Panel } from '@/components/vcp/Gate2Panel';
import { Gate3Panel } from '@/components/vcp/Gate3Panel';
import { api } from '@/lib/api-client';
import { fmtCents } from '@/lib/calc/format';
import { useSession } from '@/lib/session-context';
import type { VcpDeptDetail } from '@/lib/types/vcp';

interface CatalogResponse {
  vcpInitiatives: { id: string; name: string }[];
}

export default function VcpDepartmentDetailPage({ params }: { params: { deptId: string } }) {
  const { me } = useSession();
  const [detail, setDetail] = useState<VcpDeptDetail | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<VcpDeptDetail>(`/api/vcp/departments/${params.deptId}`)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this department.'))
      .finally(() => setLoading(false));
  }, [params.deptId]);

  useEffect(() => {
    load();
    api
      .get<CatalogResponse>('/api/catalog')
      .then(setCatalog)
      .catch(() => setCatalog(null));
  }, [load]);

  const fy = me?.fiscalYear?.id ?? '';

  return (
    <>
      <PageHeader eyebrow="Value Creation Plan" title={detail ? detail.name : 'Department'} subtitle={me?.fiscalYear?.label} />

      <div className="row" style={{ marginBottom: 16 }}>
        <Link href="/vcp" className="idc-btn idc-btn--ghost">
          <ArrowLeft size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
          Back
        </Link>
      </div>

      {loading && <div className="empty-state">Loading…</div>}
      {!loading && error && <div className="empty-state">{error}</div>}

      {!loading && detail && (
        <>
          <div className="kpi-strip">
            <div className="kpi-group">
              <div className="kpi-tile">
                <p className="kpi-tile__label">Target</p>
                <p className="kpi-tile__value">{fmtCents(detail.target)}</p>
              </div>
              <div className="kpi-tile">
                <p className="kpi-tile__label">Identified</p>
                <p className="kpi-tile__value">{fmtCents(detail.currentIdentified)}</p>
              </div>
              <div className="kpi-tile">
                <p className="kpi-tile__label">Delivered</p>
                <p className="kpi-tile__value">{fmtCents(detail.delivered)}</p>
              </div>
              <div className="kpi-tile">
                <p className="kpi-tile__label">Coverage</p>
                <p className="kpi-tile__value">
                  <CoverageChip targetCents={detail.target} deliveredCents={detail.delivered} />
                </p>
              </div>
            </div>
          </div>

          <Gate1Panel
            deptId={detail.deptId}
            fy={fy}
            gateState={detail.gates.g1}
            initiatives={detail.initiatives}
            catalogInitiatives={catalog?.vcpInitiatives ?? []}
            onChanged={load}
          />
          <Gate2Panel deptId={detail.deptId} fy={fy} gateState={detail.gates.g2} baseline={detail.baseline} onChanged={load} />
          <Gate3Panel
            deptId={detail.deptId}
            fy={fy}
            gateState={detail.gates.g3}
            targetCents={detail.target}
            validations={detail.validations}
            onChanged={load}
          />

          <div className="panel">
            <p className="panel__title">Activity</p>
            <AuditTrail entries={detail.audit} />
          </div>
        </>
      )}
    </>
  );
}
