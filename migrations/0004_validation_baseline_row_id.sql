-- ============================================================================
-- Migration 0004
--   Adds vcp_validation_rows.baseline_row_id — the exact vcp_upload_rows.id a
--   validation line was pre-filled from, echoed back via a new "Row ID (do
--   not edit)" column in the Validation workbook. Lets the admin Line Items
--   page ("was this line in baseline or added since baseline?") match on a
--   real id instead of Dept #/EE ID/name, which can collide or change.
--   Nullable: blank for a row the partner typed in by hand (genuinely new),
--   or for any validation uploaded before this column existed.
-- ============================================================================

alter table vcp_validation_rows
  add column if not exists baseline_row_id uuid references vcp_upload_rows(id);
