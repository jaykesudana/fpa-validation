import PptxGenJS from 'pptxgenjs';
import { coverage } from '@/lib/calc/vcp';
import { fmtCents } from '@/lib/calc/format';

// Server-only — imports pptxgenjs statically, which pulls in node:fs/node:https
// internally. A previous version of this module ran client-side and was
// imported (even via dynamic import()) from src/app/page.tsx; webpack still
// had to parse pptxgenjs's own module graph to build that chunk and failed
// on the node: scheme. Building the deck in a Route Handler instead sidesteps
// the problem entirely — Route Handlers are never bundled for the browser,
// so pptxgenjs's Node-only paths are exactly where it's designed to run.
// See src/app/api/export/presentation/route.ts (the only caller) and the
// client-side trigger in src/app/page.tsx, which POSTs data it already has
// and downloads the returned binary — no other file may import this one.

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
interface Group {
  key: string;
  name: string;
  rows: DeptRow[];
  totals: GroupTotals;
  initiatives?: { vcp: VcpInitiative[]; inv: InvInitiative[] };
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
      { text: label.toUpperCase(), options: { fontFace: FONT, fontSize: 7.5, color: MUTED, breakLine: true } },
      { text: value, options: { fontFace: FONT, fontSize: 16, bold: true, color: INK } },
    ],
    options: { fill: { color: BEARING }, valign: 'middle', align: 'left', margin: [5, 9, 5, 9], border: { type: 'solid', color: BORDER, pt: 0.75 } },
  };
}

const DENSE_MARGIN = [1, 3, 1, 3];
const ROOMY_MARGIN = [4, 8, 4, 8];
const THIN_BORDER = { type: 'solid', pt: 0.5, color: BORDER };
// Department, Target, Identified, Delivered, Coverage, Approved, In flight — sums to 9.3in.
const DEPT_COL_W = [2.75, 1.15, 1.15, 1.15, 0.8, 1.15, 1.15];
const APPENDIX_ROW_H = 0.3; // conservative estimate for positioning the second table on a per-group initiative slide — see note there.

/**
 * Builds an IDC-branded deck and returns it as a Buffer:
 *   1. Portfolio summary — target/identified/delivered/approved/in-flight by department
 *   2. Value Creation Plan — org-wide by initiative
 *   3. Investment Requests — org-wide by initiative
 *   4+. Two appendix slides per group — that group's department breakdown +
 *       rollup, then that group's own by-initiative breakdown (VCP and
 *       Investment). Skipped for a group with no initiative data.
 * Reflects whatever the calling viewer could already see (seesV/seesI per
 * row) — scoping happened client-side, when the data was fetched from
 * /api/summary and /api/inv/bucket; this function just formats what it's given.
 */
export async function buildPresentationBuffer(input: PresentationDeckInput): Promise<Buffer> {
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
    slide.addText(eyebrow.toUpperCase(), { x: 0.35, y: 0.18, w: 9.3, h: 0.18, fontFace: FONT, fontSize: 10, bold: true, color: BEACON } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    slide.addText(title, { x: 0.35, y: 0.36, w: 9.3, h: 0.32, fontFace: FONT, fontSize: 18, bold: true, color: INK } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    slide.addText(`${input.fiscalYearLabel}  ·  IDC FP&A Control Tower`, { x: 0.35, y: 5.42, w: 9.3, h: 0.18, fontFace: FONT, fontSize: 8, color: MUTED } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    return slide;
  }

  // One combined scorecard row — 4 VCP tiles + 2 investment tiles — rather
  // than two stacked rows, which crowded slide 1 and pushed its department
  // table past the bottom of the slide. Investment is trimmed to just
  // Approved/In-flight (dropping pool total & unallocated) per feedback.
  // Takes an explicit tile list rather than a fixed VCP+investment shape —
  // slide 1 and each group's appendix slide show all 6 (VCP + investment),
  // but slide 2 (VCP-only) and slide 3 (investment-only) need just their own
  // 4 or 2, not misleading zero-value tiles for the half that doesn't apply.
  function kpiRow(slide: ReturnType<typeof newSlide>, y: number, tiles: { label: string; value: string }[]) {
    const w = 9.3 / tiles.length;
    slide.addTable(
      [tiles.map((t) => kpiTile(t.label, t.value))] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      { x: 0.35, y, w: 9.3, colW: tiles.map(() => w) } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    );
  }

  function fullKpiTiles(figures: { target: number; identified: number; delivered: number; invApproved: number; invPending: number }) {
    return [
      { label: 'Target', value: fmtCents(figures.target) },
      { label: 'Identified', value: fmtCents(figures.identified) },
      { label: 'Delivered', value: fmtCents(figures.delivered) },
      { label: 'Coverage', value: pct(figures.target, figures.delivered) },
      { label: 'Approved investment', value: fmtCents(figures.invApproved) },
      { label: 'In flight investment', value: fmtCents(figures.invPending) },
    ];
  }

  function deptTable(slide: ReturnType<typeof newSlide>, y: number, rows: DeptRow[], totals: GroupTotals, totalLabel: string, dense: boolean) {
    const size = dense ? { header: 8, body: 7.5, total: 8 } : { header: 10, body: 9.5, total: 10 };
    const cells: Cell[][] = [
      [
        headerCell('Department', { fontSize: size.header }),
        headerCell('Target', { align: 'right', fontSize: size.header }),
        headerCell('Identified', { align: 'right', fontSize: size.header }),
        headerCell('Delivered', { align: 'right', fontSize: size.header }),
        headerCell('Coverage', { align: 'right', fontSize: size.header }),
        headerCell('Approved', { align: 'right', fontSize: size.header }),
        headerCell('In flight', { align: 'right', fontSize: size.header }),
      ],
    ];
    for (const r of rows) {
      cells.push([
        bodyCell(r.dept, { fontSize: size.body }),
        bodyCell(r.seesV ? fmtCents(r.target) : '—', { align: 'right', fontSize: size.body }),
        bodyCell(r.seesV ? fmtCents(r.identified) : '—', { align: 'right', fontSize: size.body }),
        bodyCell(r.seesV ? fmtCents(r.delivered) : '—', { align: 'right', fontSize: size.body }),
        bodyCell(r.seesV ? pct(r.target, r.delivered) : '—', { align: 'right', fontSize: size.body }),
        bodyCell(r.seesI ? fmtCents(r.invApproved) : '—', { align: 'right', fontSize: size.body }),
        bodyCell(r.seesI ? fmtCents(r.invPending) : '—', { align: 'right', fontSize: size.body }),
      ]);
    }
    cells.push([
      totalCell(totalLabel, { fontSize: size.total }),
      totalCell(fmtCents(totals.target), { align: 'right', fontSize: size.total }),
      totalCell(fmtCents(totals.identified), { align: 'right', fontSize: size.total }),
      totalCell(fmtCents(totals.delivered), { align: 'right', fontSize: size.total }),
      totalCell(pct(totals.target, totals.delivered), { align: 'right', fontSize: size.total }),
      totalCell(fmtCents(totals.invApproved), { align: 'right', fontSize: size.total }),
      totalCell(fmtCents(totals.invPending), { align: 'right', fontSize: size.total }),
    ]);
    slide.addTable(cells as any, { // eslint-disable-line @typescript-eslint/no-explicit-any
      x: 0.35,
      y,
      w: 9.3,
      colW: DEPT_COL_W,
      margin: dense ? DENSE_MARGIN : ROOMY_MARGIN,
      border: THIN_BORDER,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  function initiativeTables(
    slide: ReturnType<typeof newSlide>,
    startY: number,
    vcpInitiatives: VcpInitiative[],
    invInitiatives: InvInitiative[],
  ) {
    let y = startY;
    if (vcpInitiatives.length > 0) {
      slide.addText('Value Creation Plan', { x: 0.35, y, w: 9.3, h: 0.2, fontFace: FONT, fontSize: 12, bold: true, color: INK } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      y += 0.24;
      const rows: Cell[][] = [
        [
          headerCell('Initiative', { fontSize: 10 }),
          headerCell('Target', { align: 'right', fontSize: 10 }),
          headerCell('Identified', { align: 'right', fontSize: 10 }),
          headerCell('Delivered', { align: 'right', fontSize: 10 }),
          headerCell('Coverage', { align: 'right', fontSize: 10 }),
        ],
        ...vcpInitiatives.map((i) => [
          bodyCell(i.name, { fontSize: 10 }),
          bodyCell(fmtCents(i.target), { align: 'right', fontSize: 10 }),
          bodyCell(fmtCents(i.identified), { align: 'right', fontSize: 10 }),
          bodyCell(fmtCents(i.delivered), { align: 'right', fontSize: 10 }),
          bodyCell(pct(i.target, i.delivered), { align: 'right', fontSize: 10 }),
        ]),
      ];
      slide.addTable(rows as any, { // eslint-disable-line @typescript-eslint/no-explicit-any
        x: 0.35,
        y,
        w: 9.3,
        colW: [3.7, 1.4, 1.4, 1.4, 1.4],
        margin: ROOMY_MARGIN,
        border: THIN_BORDER,
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      // Conservative per-row estimate for positioning the NEXT table, not for
      // this one's own rendering (pptxgenjs auto-sizes that) — padded up from
      // the ~0.29in this same font/margin combo measured out to on slides 2/3,
      // since underestimating here is what overran slide 1 originally.
      y += (1 + vcpInitiatives.length) * APPENDIX_ROW_H + 0.3;
    }
    if (invInitiatives.length > 0) {
      slide.addText('Investment Requests', { x: 0.35, y, w: 9.3, h: 0.2, fontFace: FONT, fontSize: 12, bold: true, color: INK } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      y += 0.24;
      const rows: Cell[][] = [
        [
          headerCell('Initiative', { fontSize: 10 }),
          headerCell('Approved', { align: 'right', fontSize: 10 }),
          headerCell('In flight', { align: 'right', fontSize: 10 }),
          headerCell('Requests', { align: 'right', fontSize: 10 }),
        ],
        ...invInitiatives.map((i) => [
          bodyCell(i.name, { fontSize: 10 }),
          bodyCell(fmtCents(i.approved), { align: 'right', fontSize: 10 }),
          bodyCell(fmtCents(i.pending), { align: 'right', fontSize: 10 }),
          bodyCell(String(i.requestCount), { align: 'right', fontSize: 10 }),
        ]),
      ];
      slide.addTable(rows as any, { // eslint-disable-line @typescript-eslint/no-explicit-any
        x: 0.35,
        y,
        w: 9.3,
        colW: [4.5, 1.7, 1.7, 1.4],
        margin: ROOMY_MARGIN,
        border: THIN_BORDER,
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }

  // ── Slide 1 — by department ────────────────────────────────────────────
  const slide1 = newSlide('Portfolio summary', 'IDC FY27 Value Creation and Investment Planning by Department');
  kpiRow(slide1, 0.72, fullKpiTiles(grand));
  const allDeptRows = input.groups.flatMap((g) => g.rows);
  deptTable(slide1, 1.42, allDeptRows, grand, 'Total', true);

  // ── Slide 2 — VCP by initiative (org-wide) ──────────────────────────────
  const slide2 = newSlide('Value Creation Plan', 'Savings by initiative');
  kpiRow(slide2, 0.72, [
    { label: 'Target', value: fmtCents(grand.target) },
    { label: 'Identified', value: fmtCents(grand.identified) },
    { label: 'Delivered', value: fmtCents(grand.delivered) },
    { label: 'Coverage', value: pct(grand.target, grand.delivered) },
  ]);
  {
    const rows: Cell[][] = [
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
    slide2.addTable(rows as any, { x: 0.75, y: 1.5, w: 8.5, colW: [3.3, 1.3, 1.3, 1.3, 1.3], margin: ROOMY_MARGIN, border: THIN_BORDER } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  // ── Slide 3 — Investments by initiative (org-wide) ─────────────────────
  const slide3 = newSlide('Investment Requests', 'Approved & in-flight capital by initiative');
  kpiRow(slide3, 0.72, [
    { label: 'Approved investment', value: fmtCents(grand.invApproved) },
    { label: 'In flight investment', value: fmtCents(grand.invPending) },
  ]);
  {
    const rows: Cell[][] = [
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
    slide3.addTable(rows as any, { x: 0.75, y: 1.5, w: 8.5, colW: [4.1, 1.6, 1.6, 1.2], margin: ROOMY_MARGIN, border: THIN_BORDER } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  // ── Appendix — 2 slides per group ────────────────────────────────────────
  for (const g of input.groups) {
    if (g.rows.length === 0) continue;

    const slideA = newSlide(g.name, `${g.name} — department breakdown`);
    kpiRow(slideA, 0.72, fullKpiTiles(g.totals));
    deptTable(slideA, 1.42, g.rows, g.totals, `${g.name} total`, g.rows.length > 8);

    const vcpForGroup = (g.initiatives?.vcp ?? []).filter((i) => i.target !== 0 || i.identified !== 0 || i.delivered !== 0);
    const invForGroup = (g.initiatives?.inv ?? []).filter((i) => i.approved !== 0 || i.pending !== 0 || i.requestCount !== 0);
    if (vcpForGroup.length === 0 && invForGroup.length === 0) continue;

    const slideB = newSlide(g.name, `${g.name} — initiative breakdown`);
    initiativeTables(slideB, 0.6, vcpForGroup, invForGroup);
  }

  const out = await pptx.write({ outputType: 'nodebuffer' });
  return out as unknown as Buffer;
}
