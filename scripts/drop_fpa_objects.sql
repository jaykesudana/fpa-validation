-- One-off cleanup: remove the fpa-control-tower objects that were mistakenly
-- created in the shared real-estate-dashboard database before the correct
-- Neon project existed. real-estate-dashboard's own tables (offices, regions,
-- categories, actuals_lines, forecast_lines, fx_rates, import_runs,
-- account_category_map, addback_lines) are not referenced here and are left
-- untouched.

drop view if exists v_latest_approved_validation;
drop view if exists v_dept_target;
drop view if exists v_inv_dept_rollup;

drop table if exists vcp_validation_rows;
drop table if exists vcp_validations;
drop table if exists vcp_evidence;
drop table if exists vcp_upload_rows;
drop table if exists vcp_uploads;
drop table if exists vcp_targets;
drop table if exists inv_attachments;
drop table if exists inv_requests;
drop table if exists inv_bucket;
drop table if exists notifications;
drop table if exists audit_log;
drop table if exists dept_access;
drop table if exists lookup_values;
drop table if exists inv_initiatives;
drop table if exists vcp_initiatives;
drop table if exists fiscal_years;
drop table if exists departments;
drop table if exists users;

drop sequence if exists inv_request_ref_seq;
drop function if exists audit_immutable();

drop type if exists user_role;
drop type if exists tower;
drop type if exists upload_state;
drop type if exists version_state;
drop type if exists line_frequency;
drop type if exists line_status;
drop type if exists req_status;
drop type if exists inv_type;
drop type if exists region_code;
