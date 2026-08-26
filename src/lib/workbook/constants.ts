// 02-WORKBOOKS.md §4. Category/Frequency/Status/Country are fixed enums.
// Initiative is the admin-editable VCP catalogue — always passed in from the
// database, never hardcoded here.

export const CATEGORIES = [
  'Revenue increase',
  'HC savings',
  'Vendor elimination',
  'Process efficiency',
  'Risk / compliance reduction',
  'HC reinvestment',
  'Vendor reinvestment',
  'Implementation',
] as const;

export const FREQUENCIES = ['Run rate', 'One-time'] as const;

export const LINE_STATUSES = ['Identified', 'Confirmed', 'Not confirmed'] as const;

export const COUNTRIES = [
  'US', 'Australia', 'China', 'Hong Kong', 'India', 'Indonesia', 'Japan', 'Korea',
  'Malaysia', 'New Zealand', 'Philippines', 'Singapore', 'Taiwan', 'Thailand',
  'Austria', 'Belgium', 'Bulgaria', 'Czech Republic', 'Denmark', 'Egypt', 'France',
  'Germany', 'Greece', 'Hungary', 'Ireland', 'Israel', 'Italy', 'Kazakhstan', 'Kenya',
  'Netherlands', 'Nigeria', 'Poland', 'Portugal', 'Romania', 'Russia', 'Saudi Arabia',
  'Serbia', 'South Africa', 'Spain', 'Sweden', 'Turkey', 'UAE', 'UK', 'Ukraine',
  'Argentina', 'Brazil', 'Chile', 'Mexico', 'Peru', 'Canada',
] as const;

export const IDENTIFIED_HEADERS = [
  'Initiative', 'Dept #', 'Name', 'Category', 'EE ID', 'Country', 'Frequency',
  'Target date', 'Identified amount', 'Notes',
];

export const VALIDATION_EXTRA_HEADERS = ['Status', 'Validated Amount', 'Validated Date', 'Status Update'];

export const IDENTIFIED_COLUMN_WIDTHS = [22, 10, 30, 22, 10, 12, 12, 13, 15, 32];
export const VALIDATION_COLUMN_WIDTHS = [22, 10, 30, 22, 10, 12, 12, 13, 15, 26, 13, 15, 14, 26];
export const ALLOWED_VALUES_COLUMN_WIDTHS = [24, 24, 16, 16, 16];
