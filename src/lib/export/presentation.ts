import { coverage } from '@/lib/calc/vcp';
import { fmtCents } from '@/lib/calc/format';

// IDC brand tokens (src/styles/design-tokens.css), hex without '#' for pptxgenjs.
const INK = '1D1D7F';
const BEACON = '166BF4';
const BEARING = 'F8F3EF';
const FUTURE_WHITE = 'FFFCFA';
const BLACK = '191919';
const MUTED = '4A4A55';
const BORDER = 'E3DED6';
// Plus Jakarta Sans is the documented Mundial substitute for brand headings/body
// (see design-tokens.css). Best-effort: pptxgenjs can only reference a font
// name, not embed the file, so PowerPoint falls back to a default sans on a
// machine that doesn't have it installed.
const FONT = 'Plus Jakarta Sans';

// Shaped to match pptxgenjs's actual TableCell/TableCellProps (verified
// against its .d.ts, not guessed) but declared locally rather than imported,
// since those interfaces aren't part of the package's public named exports.
// Passed through `as any` at each addTable/addText call site — the same
// "third-party type surface too specific to chase" escape hatch already
// established in this codebase for the Neon driver (`as unknown as Promise<T[]>`).
interface Cell {
  text: string | Cell[];
  options?: Record<string, unknown>;
}

interface DeptRow {
  dept: string;
  deptId: string;
  seesV: boolean;
  seesI: boolean;
  target: number;
  identified: number;
  delivered: number;
  invApproved: number;
  invPending: number;
}
interface GroupTotals {
  target: number;
  identified: number;
  delivered: number;
  invApproved: number;
  invPending: number;
}
interface Group {
  key: string;
  name: string;
  rows: DeptRow[];
  totals: GroupTotals;
}
interface VcpInitiative {
  name: string;
  target: number;
  identified: number;
  delivered: number;
}
interface InvInitiative {
  name: string;
  approved: number;
  pending: number;
  requestCount: number;
}
interface Bucket {
  total: number;
  approved: number;
  pending: number;
  unallocated: number;
}

export interface PresentationDeckInput {
  fiscalYearLabel: string;
  groups: Group[];
  vcpInitiatives: VcpInitiative[];
  invInitiatives: InvInitiative[];
  bucket: Bucket | null;
}

function pct(target: number, delivered: number): string {
  return `${Math.round(coverage(target, delivered) * 100)}%`;
}

function headerCell(text: string, opts: { align?: 'left' | 'right'; fontSize?: number } = {}): Cell {
  return {
    text,
    options: { fontFace: FONT, bold: true, fontSize: opts.fontSize ?? 9, color: INK, fill: { color: BEARING }, align: opts.align ?? 'left', valign: 'middle' },
  };
}

function bodyCell(text: string, opts: { align?: 'left' | 'right'; fontSize?: number } = {}): Cell {
  return { text, options: { fontFace: FONT, fontSize: opts.fontSize ?? 8, color: BLACK, align: opts.align ?? 'left', valign: 'middle' } };
}

function totalCell(text: string, opts: { align?: 'left' | 'right'; fontSize?: number } = {}): Cell {
  return {
    text,
    options: {
      fontFace: FONT,
      fontSize: opts.fontSize ?? 8.5,
      bold: true,
      color: INK,
      align: opts.align ?? 'left',
      valign: 'middle',
      border: { type: 'solid', pt: 1, color: INK },
    },
  };
}

function kpiTile(label: string, value: string): Cell {
  return {
    text: [
      { text: label.toUpperCase(), options: { fontFace: FONT, fontSize: 8, color: MUTED, breakLine: true } },
      { text: value, options: { fontFace: FONT, fontSize: 18, bold: true, color: INK } },
    ],
    options: { fill: { color: BEARING }, valign: 'middle', align: 'left', margin: [6, 10, 6, 10], border: { type: 'solid', color: BORDER, pt: 0.75 } },
  };
}

const KPI_COL_W = [2.325, 2.325, 2.325, 2.325];
const DENSE_MARGIN = [1.5, 4, 1.5, 4];
const ROOMY_MARGIN = [4, 8, 4, 8];
const THIN_BORDER = { type: 'solid', pt: 0.5, color: BORDER };

/**
 * Builds and downloads a 3-slide IDC-branded deck from data the Summary page
 * already has loaded — no server round trip. Slide 1: target/identified/
 * delivered/approved/in-flight by department. Slide 2: VCP by initiative.
 * Slide 3: Investment requests by initiative. Reflects whatever the calling
 * viewer can already see (seesV/seesI per row) — same scoping as every other
 * view in the app, not a separate export permission.
 */
export async function exportPresentationDeck(input: PresentationDeckInput): Promise<void> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  const grand = input.groups.reduce(
    (acc, g) => ({
      target: acc.target + g.totals.target,
      identified: acc.identified + g.totals.identified,
      delivered: acc.delivered + g.totals.delivered,
      invApproved: acc.invApproved + g.totals.invApproved,
      invPending: acc.invPending + g.totals.invPending,
    }),
    { target: 0, identified: 0, delivered: 0, invApproved: 0, invPending: 0 },
  );

  function newSlide(eyebrow: string, title: string) {
    const slide = pptx.addSlide();
    slide.background = { color: FUTURE_WHITE };
    slide.addText(eyebrow.toUpperCase(), { x: 0.35, y: 0.2, w: 9.3, h: 0.2, fontFace: FONT, fontSize: 10, bold: true, color: BEACON } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    slide.addText(title, { x: 0.35, y: 0.4, w: 9.3, h: 0.32, fontFace: FONT, fontSize: 20, bold: true, color: INK } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    slide.addText(`${input.fiscalYearLabel}  ·  IDC FP&A Control Tower`, { x: 0.35, y: 5.42, w: 9.3, h: 0.18, fontFace: FONT, fontSize: 8, color: MUTED } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    return slide;
  }

  function vcpKpiRow(slide: ReturnType<typeof newSlide>) {
    slide.addTable(
      [[kpiTile('VCP target', fmtCents(grand.target)), kpiTile('Identified', fmtCents(grand.identified)), kpiTile('Delivered', fmtCents(grand.delivered)), kpiTile('Coverage', pct(grand.target, grand.delivered))]] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      { x: 0.35, y: 0.85, w: 9.3, colW: KPI_COL_W } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    );
  }

  function invKpiRow(slide: ReturnType<typeof newSlide>, y: number) {
    slide.addTable(
      [
        [
          kpiTile('Investment pool', input.bucket ? fmtCents(input.bucket.total) : '—'),
          kpiTile('Approved', input.bucket ? fmtCents(input.bucket.approved) : '—'),
          kpiTile('In flight', input.bucket ? fmtCents(input.bucket.pending) : '—'),
          kpiTile('Unallocated', input.bucket ? fmtCents(input.bucket.unallocated) : '—'),
        ],
      ] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      { x: 0.35, y, w: 9.3, colW: KPI_COL_W } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    );
  }

  // ── Slide 1 — by department ────────────────────────────────────────────
  const slide1 = newSlide('Portfolio summary', 'Target, identified, delivered & investment — by department');
  vcpKpiRow(slide1);
  invKpiRow(slide1, 1.42);

  const deptRows: Cell[][] = [
    [
      headerCell('Group'),
      headerCell('Department'),
      headerCell('Target', { align: 'right' }),
      headerCell('Identified', { align: 'right' }),
      headerCell('Delivered', { align: 'right' }),
      headerCell('Coverage', { align: 'right' }),
      headerCell('Approved', { align: 'right' }),
      headerCell('In flight', { align: 'right' }),
    ],
  ];
  for (const g of input.groups) {
    for (const r of g.rows) {
      deptRows.push([
        bodyCell(g.name),
        bodyCell(r.dept),
        bodyCell(r.seesV ? fmtCents(r.target) : '—', { align: 'right' }),
        bodyCell(r.seesV ? fmtCents(r.identified) : '—', { align: 'right' }),
        bodyCell(r.seesV ? fmtCents(r.delivered) : '—', { align: 'right' }),
        bodyCell(r.seesV ? pct(r.target, r.delivered) : '—', { align: 'right' }),
        bodyCell(r.seesI ? fmtCents(r.invApproved) : '—', { align: 'right' }),
        bodyCell(r.seesI ? fmtCents(r.invPending) : '—', { align: 'right' }),
      ]);
    }
  }
  deptRows.push([
    totalCell('Total'),
    totalCell(''),
    totalCell(fmtCents(grand.target), { align: 'right' }),
    totalCell(fmtCents(grand.identified), { align: 'right' }),
    totalCell(fmtCents(grand.delivered), { align: 'right' }),
    totalCell(pct(grand.target, grand.delivered), { align: 'right' }),
    totalCell(fmtCents(grand.invApproved), { align: 'right' }),
    totalCell(fmtCents(grand.invPending), { align: 'right' }),
  ]);
  slide1.addTable(deptRows as any, { // eslint-disable-line @typescript-eslint/no-explicit-any
    x: 0.35,
    y: 2.0,
    w: 9.3,
    colW: [1.0, 2.35, 1.05, 1.05, 1.05, 0.7, 1.05, 1.05],
    margin: DENSE_MARGIN,
    border: THIN_BORDER,
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

  // ── Slide 2 — VCP by initiative ─────────────────────────────────────────
  const slide2 = newSlide('Value Creation Plan', 'Savings by initiative');
  vcpKpiRow(slide2);
  const vcpRows: Cell[][] = [
    [
      headerCell('Initiative', { fontSize: 11 }),
      headerCell('Target', { align: 'right', fontSize: 11 }),
      headerCell('Identified', { align: 'right', fontSize: 11 }),
      headerCell('Delivered', { align: 'right', fontSize: 11 }),
      headerCell('Coverage', { align: 'right', fontSize: 11 }),
    ],
    ...input.vcpInitiatives.map((i) => [
      bodyCell(i.name, { fontSize: 11 }),
      bodyCell(fmtCents(i.target), { align: 'right', fontSize: 11 }),
      bodyCell(fmtCents(i.identified), { align: 'right', fontSize: 11 }),
      bodyCell(fmtCents(i.delivered), { align: 'right', fontSize: 11 }),
      bodyCell(pct(i.target, i.delivered), { align: 'right', fontSize: 11 }),
    ]),
  ];
  slide2.addTable(vcpRows as any, { // eslint-disable-line @typescript-eslint/no-explicit-any
    x: 0.75,
    y: 1.75,
    w: 8.5,
    colW: [3.3, 1.3, 1.3, 1.3, 1.3],
    margin: ROOMY_MARGIN,
    border: THIN_BORDER,
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

  // ── Slide 3 — Investments by initiative ─────────────────────────────────
  const slide3 = newSlide('Investment Requests', 'Approved & in-flight capital by initiative');
  invKpiRow(slide3, 0.85);
  const invRows: Cell[][] = [
    [
      headerCell('Initiative', { fontSize: 11 }),
      headerCell('Approved', { align: 'right', fontSize: 11 }),
      headerCell('In flight', { align: 'right', fontSize: 11 }),
      headerCell('Requests', { align: 'right', fontSize: 11 }),
    ],
    ...input.invInitiatives.map((i) => [
      bodyCell(i.name, { fontSize: 11 }),
      bodyCell(fmtCents(i.approved), { align: 'right', fontSize: 11 }),
      bodyCell(fmtCents(i.pending), { align: 'right', fontSize: 11 }),
      bodyCell(String(i.requestCount), { align: 'right', fontSize: 11 }),
    ]),
  ];
  slide3.addTable(invRows as any, { // eslint-disable-line @typescript-eslint/no-explicit-any
    x: 0.75,
    y: 1.75,
    w: 8.5,
    colW: [4.1, 1.6, 1.6, 1.2],
    margin: ROOMY_MARGIN,
    border: THIN_BORDER,
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

  const safeFy = input.fiscalYearLabel.replace(/[^a-zA-Z0-9-]+/g, '-');
  await pptx.writeFile({ fileName: `IDC-Portfolio-Summary-${safeFy}.pptx` });
}
