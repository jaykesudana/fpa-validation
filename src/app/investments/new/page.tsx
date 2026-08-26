'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/chrome/PageHeader';
import { api, uploadFile } from '@/lib/api-client';
import { deriveRegion, type Region } from '@/lib/calc/investments';
import { fmtCents } from '@/lib/calc/format';
import { useSession } from '@/lib/session-context';
import { useToast } from '@/lib/toast-context';

interface CatalogResponse {
  departments: { id: string; name: string }[];
  invInitiatives: { id: string; name: string }[];
  investmentCountriesByRegion: Record<Region, string[]>;
  invTypes: readonly string[];
}

const QUARTER_KEYS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;

export default function NewRequestPage() {
  const { me } = useSession();
  const { showToast } = useToast();
  const router = useRouter();

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [title, setTitle] = useState('');
  const [deptId, setDeptId] = useState('');
  const [initiativeId, setInitiativeId] = useState('');
  const [type, setType] = useState('Headcount');
  const [country, setCountry] = useState('United States');
  const [amount, setAmount] = useState('');
  const [phasing, setPhasing] = useState({ Q1: '', Q2: '', Q3: '', Q4: '' });
  const [expectedReturn, setExpectedReturn] = useState('');
  const [payback, setPayback] = useState('');
  const [sponsor, setSponsor] = useState('');
  const [execSponsor, setExecSponsor] = useState('');
  const [businessCase, setBusinessCase] = useState('');
  const [risk, setRisk] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<CatalogResponse>('/api/catalog')
      .then(setCatalog)
      .catch(() => setCatalog(null));
  }, []);

  const allowedDeptIds = me?.access.inv ?? [];
  const availableDepts = (catalog?.departments ?? []).filter((d) => me?.user.role === 'admin' || allowedDeptIds.includes(d.id));

  const region = deriveRegion(country);
  const amountCents = Math.round((Number(amount) || 0) * 100);
  const phasingSumCents = QUARTER_KEYS.reduce((s, q) => s + Math.round((Number(phasing[q]) || 0) * 100), 0);

  async function saveAndMaybeSubmit(submit: boolean) {
    if (!title.trim() || !deptId || amountCents <= 0) {
      showToast('Title, department, and an amount greater than 0 are required.', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await api.post<{ id: string; ref: string }>('/api/inv/requests', {
        fy: me?.fiscalYear?.id,
        title,
        deptId,
        initiativeId: initiativeId || undefined,
        type,
        country,
      });

      await api.patch(`/api/inv/requests/${created.id}`, {
        amountCents,
        phasing: {
          Q1: Math.round((Number(phasing.Q1) || 0) * 100),
          Q2: Math.round((Number(phasing.Q2) || 0) * 100),
          Q3: Math.round((Number(phasing.Q3) || 0) * 100),
          Q4: Math.round((Number(phasing.Q4) || 0) * 100),
        },
        expectedReturnCents: Math.round((Number(expectedReturn) || 0) * 100),
        payback,
        sponsor,
        execSponsor,
        businessCase,
        risk,
      });

      if (files.length > 0) {
        const form = new FormData();
        files.forEach((f) => form.append('file', f));
        await uploadFile(`/api/inv/requests/${created.id}/attachments`, form);
      }

      if (submit) {
        const res = await api.post<{ warning?: string | null }>(`/api/inv/requests/${created.id}/submit`);
        if (res.warning) showToast(res.warning, 'error');
      }

      showToast(submit ? `${created.ref} submitted.` : `${created.ref} saved as a draft.`, 'success');
      router.push(`/investments/${created.id}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the request.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Investment Requests" title="New request" />
      <div className="panel">
        <div className="stack">
          <div className="idc-field">
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="row">
            <div className="idc-field" style={{ flex: 1 }}>
              <label>Department</label>
              <select value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                <option value="">Choose a department…</option>
                {availableDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="idc-field" style={{ flex: 1 }}>
              <label>Initiative</label>
              <select value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)}>
                <option value="">—</option>
                {(catalog?.invInitiatives ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="idc-field" style={{ flex: 1 }}>
              <label>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {(catalog?.invTypes ?? ['Headcount', 'Vendor', 'Capex', 'Program']).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="row">
            <div className="idc-field" style={{ flex: 1 }}>
              <label>Country</label>
              <select value={country} onChange={(e) => setCountry(e.target.value)}>
                {Object.entries(catalog?.investmentCountriesByRegion ?? ({} as Record<Region, string[]>)).map(([r, countries]) => (
                  <optgroup label={r} key={r}>
                    {countries.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="idc-field" style={{ flex: 1 }}>
              <label>Region (derived)</label>
              <input value={region} readOnly />
            </div>
            <div className="idc-field" style={{ flex: 1 }}>
              <label>Amount</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>

          <div className="section-label">Quarterly phasing</div>
          <div className="row">
            {QUARTER_KEYS.map((q) => (
              <div className="idc-field" key={q} style={{ flex: 1 }}>
                <label>{q}</label>
                <input type="number" value={phasing[q]} onChange={(e) => setPhasing((p) => ({ ...p, [q]: e.target.value }))} />
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: -8 }}>
            Phasing total {fmtCents(phasingSumCents)} vs requested {fmtCents(amountCents)}
            {phasingSumCents !== amountCents && amountCents > 0 && ' — mismatch warns on submit, never blocks.'}
          </p>

          <div className="row">
            <div className="idc-field" style={{ flex: 1 }}>
              <label>Expected return</label>
              <input type="number" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} />
            </div>
            <div className="idc-field" style={{ flex: 1 }}>
              <label>Payback</label>
              <input value={payback} onChange={(e) => setPayback(e.target.value)} />
            </div>
          </div>
          <div className="row">
            <div className="idc-field" style={{ flex: 1 }}>
              <label>Sponsor</label>
              <input value={sponsor} onChange={(e) => setSponsor(e.target.value)} />
            </div>
            <div className="idc-field" style={{ flex: 1 }}>
              <label>Exec sponsor</label>
              <input value={execSponsor} onChange={(e) => setExecSponsor(e.target.value)} />
            </div>
          </div>
          <div className="idc-field">
            <label>Business case</label>
            <textarea rows={3} value={businessCase} onChange={(e) => setBusinessCase(e.target.value)} />
          </div>
          <div className="idc-field">
            <label>Risk</label>
            <textarea rows={3} value={risk} onChange={(e) => setRisk(e.target.value)} />
          </div>
          <div className="idc-field">
            <label>Attachments</label>
            <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </div>

          <div className="row">
            <button type="button" className="idc-btn idc-btn--ghost" disabled={busy} onClick={() => saveAndMaybeSubmit(false)}>
              Save draft
            </button>
            <button type="button" className="idc-btn idc-btn--primary" disabled={busy} onClick={() => saveAndMaybeSubmit(true)}>
              Submit
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
