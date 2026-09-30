// Config.gs — names, schemas, field positions, and controlled options.
const APFP = Object.freeze({
 SCHEMA_VERSION: '2026-09-01-v15.0',
 FONT_FAMILY: 'Arial',
 TIME_ZONE: 'Asia/Kolkata',
 HIDDEN_SYSTEM_SHEETS: [
   'System - Configuration',
   'System - Technical Registry',
   'System - Organisation Leadership'
 ],
 SHEETS: {
   START: 'Start Here',
   INTAKE: '1. Workspace Creator',
   MATURITY: '7. Organisation Maturity',
   GRANTS: '8. Grant Registry',
   ORGANISATIONS: '9. Organisation Registry',
   OUTCOMES: '2. Outcome Progress',
   SUPPORT: '3. Support',
   DECISIONS: '4. Decision Tracker',
   DIVIDENDS: '5. Dividends',
   DISBURSEMENTS: '6. Committed & Spent Tracker',
   CONFIG: 'System - Configuration',
   EXCEPTIONS: 'System - Exceptions Log',
   TECHNICAL: 'System - Technical Registry',
   LEADERSHIP: 'System - Organisation Leadership'
 },
 TEMPLATE_SHEETS: {
   INSTRUCTIONS: 'Instructions', LINKS: 'Links', ORG_INFO: 'A. Org Information',
   GRANT_FUNDING: 'B. Grant & Funding', PROJECT_DESIGN: 'C. Project Design',
   OUTCOMES: 'D. Outcomes', ANNEXURE: 'E. Annexure',
   FIELD_CONFIG: 'Field Config', VALIDATION_MASTER: '_Validation_Master',
   REGISTRY_EXPORT: 'System - Registry Export'
 },
 OUTCOME_TEMPLATE_SHEETS: {
   OUTCOMES: 'Outcome Progress', DISBURSEMENTS: 'Disbursement Documents',
   YEAR_END: 'Year-End Documents', FIELD_CONFIG: 'Field Config',
   TRACKER_EXPORT: 'System - Tracker Export'
 },
 GENERATED_VISIBLE_SHEETS: [
   'Instructions', 'Links', 'A. Org Information', 'B. Grant & Funding',
   'C. Project Design', 'D. Outcomes', 'E. Annexure'
 ],
 GRANT_TYPES: ['Restricted', 'Unrestricted', 'Transactional', 'Discretionary'],
 GRANT_STATUSES: ['Active', 'Discontinued', 'Complete'],
 DISBURSEMENT_TRACKER_SHEET: '6. Committed & Spent Tracker',
 DISBURSEMENT_STATUSES: ['Committed', 'Disbursed', 'Discontinued'],
 DISBURSEMENT_HEADERS: [
   'Disbursement ID', 'Financial Year', 'Quarter', 'Organisation Name',
   'Grant Title', 'Planned Date', 'Planned Amount', 'Notes', 'Status',
   'Actual Date', 'Actual Amount', 'Disbursed Account', 'UTR',
   'Donation Receipt Link', 'Donation Letter Link', 'Grant ID'
 ],
 MATURITY: {
   HEADER_ROW: 2,
   START_ROW: 3,
   TABLE_NAME: 'OrganisationMaturityTable',
   CATALOGUE_NAMED_RANGE: 'APFP_MATURITY_CATALOGUE',
   STATUS_NAMED_RANGE: 'APFP_MATURITY_STATUSES',
   EXPECTED_INDICATOR_COUNT: 11,
   EXPECTED_STATUS_COUNT: 3,
   HEADERS: ['Financial Year', 'Grant ID', 'Organisation Name', 'Grant Title', 'Aspect', 'Indicator', 'Status']
 },
 OUTCOME_EXPORT_HEADERS: [
   'Financial Year','Organisation Name','Grant Title','Grant ID','Outcome ID','Outcome / Indicator','End-of-Program Cycle Target',
   'Q1 Progress','Q1 Evidence Link','Q1 Support Type','Q1 Support Required','Q1 Status','Q1 Anagha Notes',
   'Q2 Progress','Q2 Evidence Link','Q2 Support Type','Q2 Support Required','Q2 Status','Q2 Anagha Notes',
   'Q3 Progress','Q3 Evidence Link','Q3 Support Type','Q3 Support Required','Q3 Status','Q3 Anagha Notes',
   'Q4 Progress','Q4 Evidence Link','Q4 Support Type','Q4 Support Required','Q4 Status','Q4 Anagha Notes','Final Actual'
 ],
 PREFLIGHT_SCHEMA: {
   REQUIRED_CONFIG_KEYS: [
     'ROOT_FOLDER_ID', 'SETUP_TEMPLATE_ID',
     'OUTCOME_PROGRESS_TEMPLATE_ID', 'FINANCIAL_YEAR_FOLDER_PATTERN',
     'ORGANISATION_FOLDER_PATTERN', 'SETUP_WORKBOOK_PATTERN',
     'OUTCOME_PROGRESS_WORKBOOK_PATTERN', 'DISBURSEMENT_DOCUMENT_TEMPLATE_ID',
     'DISBURSEMENT_WORKBOOK_PATTERN', 'SUPPORTING_DOCUMENTS_FOLDER_NAME',
     'BUDGET_UTILISATION_FOLDER_NAME', 'WORKSPACE_EMAIL_TEMPLATE_DOC_ID',
     'DATA_SYNC_SCHEMA_VERSION'
   ],
   CENTRAL_HEADER_ROWS: {
     INTAKE: 2,
     ORGANISATIONS: 1,
     GRANTS: 1,
     OUTCOMES: 2,
     SUPPORT: 2,
     DECISIONS: 2,
     DIVIDENDS: 2,
     DISBURSEMENTS: 2,
     MATURITY: 2,
     TECHNICAL: 2,
     LEADERSHIP: 2
   },
   CENTRAL_HEADERS: {
     OUTCOMES: [
       'Financial Year','Organisation Name','Grant Title','Grant ID','Outcome ID','Outcome / Indicator','End-of-Program Cycle Target',
       'Q1 Progress','Q1 Evidence Link','Q1 Status','Q1 Anagha Notes',
       'Q2 Progress','Q2 Evidence Link','Q2 Status','Q2 Anagha Notes',
       'Q3 Progress','Q3 Evidence Link','Q3 Status','Q3 Anagha Notes',
       'Q4 Progress','Q4 Evidence Link','Q4 Status','Q4 Anagha Notes','Final Actual'
     ],
     SUPPORT: [
       'Financial Year','Organisation Name','Grant Title','Grant ID','Outcome Indicator','Outcome ID','Quarter',
       'Support Type','Support Required','Evidence Link','Status','Anagha Notes'
     ],
     DECISIONS: [
       'Decision For FY','Previous Grant FY','Organisation Name','Grant Title','Grant Type','Grant ID','Outcome Summary','Evidence / Workspace Link',
       'Decision Type','Decision Status','Decision Rationale','Proposed Amount','Decision Due Date','Annual Report Link','Fund Utilisation Link','10BE Form Link',
       'Maturity — Clarity RAG','Maturity — Capacity RAG','Maturity — Compliance RAG'
     ],
     DIVIDENDS: ['FY', 'Dividends']
   },
   LINKS: {
     HEADER_ROW: 3,
     DATA_START_ROW: 4,
     RESOURCE_COLUMN: 1,
     LINK_COLUMN: 2
   },
   SETUP_LINK_RESOURCES: [
     'Organisation Workspace',
     'Supporting & Compliance Documents',
     'Budget Allocation & Fund Utilisation'
   ],
   OUTCOME_LINK_RESOURCES: [
     'Organisation Workspace', 'Progress Report Q1', 'Progress Report Q2',
     'Progress Report Q3', 'Progress Report Q4', 'Budget Allocation & Fund Utilisation',
     'Disbursement Documents', 'Outcome Progress, Disbursement & Supporting Documents Workbook'
   ],
   TRANSACTIONAL_TEMPLATE: {
      HEADER_ROW: 4,
      DATA_START_ROW: 5,
      DATA_ROWS: 100,
      EDITABLE_RANGE: 'F5:G104',
      HEADERS: [
        'Grant ID',
        'Disbursement ID',
        'Disbursement Date',
        'Disbursed Amount',
        'Upload Folder',
        'Donation Receipt Link',
        'Donation Letter Link'
      ]
    },

    OUTCOME_TEMPLATE: {
      GRANT_TITLE_CELL: 'B4',
      GRANT_TITLE_LABEL: 'Grant Title',
      DATA_START_ROW: 5,
      DATA_ROWS: 10,
      TOTAL_COLUMNS: 26,
      SYSTEM_COLUMNS: 5,
      EDITABLE_RANGES: [
        'F5:F14',
        'H5:K14',
        'M5:P14',
        'R5:U14',
        'W5:Z14'
      ],
      YEAR_END_GRANT_ID_CELL: 'A5',
      YEAR_END_EDITABLE_RANGES: ['C5', 'E5']
    },
   SETUP_EXPORT_SECTIONS: [
     { HEADER_ROW: 2, DATA_START_ROW: 3, DATA_ROWS: 1, HEADERS_SOURCE: 'ORGANISATION_HEADERS', LABEL: 'Organisation Registry', MIN_FORMULAS: 10 },
     { HEADER_ROW: 6, DATA_START_ROW: 7, DATA_ROWS: 1, HEADERS_SOURCE: 'GRANT_HEADERS', LABEL: 'Grant Registry', MIN_FORMULAS: 20 }
   ],
   OUTCOME_EXPORT_SECTIONS: [
     { HEADER_ROW: 2, DATA_START_ROW: 3, DATA_ROWS: 10, HEADERS_SOURCE: 'OUTCOME_EXPORT_HEADERS', LABEL: 'Outcome Progress', MIN_FORMULAS: 5 },
     { HEADER_ROW: 15, DATA_START_ROW: 16, DATA_ROWS: 40, HEADERS_SOURCE: 'SUPPORT', LABEL: 'Support', MIN_FORMULAS: 5 },
     { HEADER_ROW: 58, DATA_START_ROW: 59, DATA_ROWS: 100, HEADERS_SOURCE: 'DISBURSEMENT_HEADERS', LABEL: 'Disbursement', MIN_FORMULAS: 3 }
   ]
 },
 INTAKE: {
   HEADER_ROW: 2, START_ROW: 3, MAX_ROW: 501,
   FINANCIAL_YEAR_COLUMN: 1,
   GRANT_START_DATE_COLUMN: 2,
   GRANT_END_DATE_COLUMN: 3,
   ORGANISATION_TYPE_COLUMN: 4,
   ORGANISATION_NAME_COLUMN: 5,
   THEMATIC_AREA_COLUMN: 6,
   THEMATIC_SUBAREA_COLUMN: 7,
   PROXIMITY_COLUMN: 8,
   PROJECT_TITLE_COLUMN: 9,
   GRANT_TYPE_COLUMN: 10,
   AMOUNT_APPROVED_COLUMN: 11,
   PRIMARY_CONTACT_EMAIL_COLUMN: 12,
   GRANT_STATUS_COLUMN: 13,
   ACTION_COLUMN: 14,
   DUPLICATE_COUNT_COLUMN: 15,
   WORKSPACE_STATUS_COLUMN: 16,
   ORGANISATION_WORKSPACE_COLUMN: 17,
   SETUP_WORKBOOK_COLUMN: 18,
   OUTCOME_TRACKER_COLUMN: 19,
   SUPPORTING_COLUMN: 20,
   BUDGET_UTILISATION_COLUMN: 21,
   REVIEW_STATUS_COLUMN: 22,
   Q1_COLUMN: 23, Q2_COLUMN: 24, Q3_COLUMN: 25, Q4_COLUMN: 26,
   DISBURSEMENT_COLUMN: 27,
   LAST_UPDATED_COLUMN: 28,
   REQUEST_ID_COLUMN: 29,
   ORGANISATION_ID_COLUMN: 30,
   GRANT_ID_COLUMN: 31,
   WORKSPACE_ID_COLUMN: 32,
   IDENTITY_START_COLUMN: 1,
   IDENTITY_COLUMN_COUNT: 9,
   HIDDEN_TECH_START_COLUMN: 29,
   HIDDEN_TECH_COLUMN_COUNT: 4,
   HEADERS: [
     'Financial Year', 'Grant Start Date', 'Grant End Date', 'Organisation Type',
     'Organisation Name', 'Thematic Area', 'Thematic Sub-area', 'Proximity to Children / Beneficiary',
     'Grant Title', 'Grant Type', 'Amount Approved', 'Primary Contact Email',
     'Grant Status', 'Action', 'Duplicate?', 'Workspace Status',
     'Organisation Workspace', 'Setup Workbook', 'Outcome, Support and Disbursement Tracker', 'Supporting & Compliance',
     'Budget Allocation & Fund Utilisation', 'Setup Review Status',
     'Progress Report Q1', 'Progress Report Q2', 'Progress Report Q3', 'Progress Report Q4',
     'Disbursement Documents', 'Last Updated', 'Request ID', 'Organisation ID', 'Grant ID', 'Workspace ID'
   ],
   PROCESS_ACTIONS: ['Create Workspace', 'Retry Workspace', 'Retry Sharing'],
   ACTIONS: ['Create Workspace', 'Retry Workspace', 'Retry Sharing', 'Completed']
 },
 ORGANISATION_HEADERS: [
   'Organisation ID', 'Organisation Name', 'Name as per Registration Certificate',
   'Formal Legal Status', 'Year of Registration', 'Mailing Address', 'Website URL',
   'Primary Contact Name', 'Primary Contact Designation', 'Primary Contact Phone',
   'Primary Contact Email', 'CSR / UIN Number', 'PAN Number', 'TAN Number',
   'Mission Statement', 'Vision Statement', 'Geographical Presence',
   'Code of Conduct Policy?', 'POSH Policy?', 'Child Protection Policy?',
   'Data Protection Policy?', 'Other Policy', 'Human Resource SOP?',
   'Purchase & Procurement SOP?', 'Finance & Accounting SOP?', 'Other SOP',
   'FCRA Registration Link', 'Section 12A Registration Link', 'Section 80G Link',
   'PAN Card Link', 'TAN Card Link', 'Latest Annual Report Link',
   'Financial Audit Report Link', 'CSR Registration Link', 'Registration Certificate Link',
   'Record Status', 'Source Setup Workbook URL', 'Master Data Synced At', 'Template Schema Version',
   'FCRA Registration Expiry Date', 'Section 12A Registration Expiry Date', 'Section 80G Expiry Date'
 ],
 GRANT_HEADERS: [
   'Grant ID', 'Financial Year', 'Grant Start Quarter', 'Organisation ID', 'Organisation Name',
   'Thematic Area', 'Thematic Sub-area', 'Proximity to Children / Beneficiary',
   'Project Title', 'Grant Start Date', 'Grant End Date', 'Grant Type', 'Amount Approved',
   'Grant Status', 'Programme Status', 'Years Implemented', 'Project Duration (Months)',
   'Total Project Budget', 'States Covered', 'Districts Covered', 'Amount Requested',
   'Funds Raised from Other Sources?', 'Other Funding Details', 'Other Funders Considering?',
   'Other Funders Considering Details', 'Bank Name', 'Account Holder Name', 'Account Number',
   'IFSC Code', 'Itemised Budget Link', 'Problem Statement',
   'Visualising Success', 'Project Model / Key Features', 'Scale Potential', 'Stakeholders',
   'Beneficiaries', 'Stakeholder / Community Consultation', 'Critical Partnerships / Relationships',
   'Approach to Learning', 'Team Size — Current FY', 'Employee Attrition — Current Snapshot',
   'Attrition Context / Notes — Current Snapshot', 'Pending Cases / Complaints',
   'Annual Budget — Current FY', 'Annual Budget — Previous FY', 'Annual Budget — Two FY Ago',
   'Current Funders', 'Primary Contact Email', 'Master Data Sync Status', 'Record Status',
   'Setup Created At', 'Last Updated At', 'Source Setup Workbook URL', 'Master Data Synced At',
   'Template Schema Version', 'Team Size — Previous FY', 'Employee Attrition — Previous Snapshot',
   'Attrition Context / Notes — Previous Snapshot',
   'Primary Beneficiary Group', 'Primary Beneficiary Count'
 ],
 LEADERSHIP_HEADERS: [
   'Organisation ID', 'Role', 'Name', 'Designation', 'Email', 'Contact', 'LinkedIn Profile',
   'Source Setup Workbook URL', 'Master Data Synced At', 'Template Schema Version', 'Record Status'
 ],
 TECH_HEADERS: [
   'Request ID', 'Organisation ID', 'Grant ID', 'Workspace ID', 'Run ID',
   'Financial Year', 'Grant Start Quarter', 'Grant Start Date', 'Grant End Date', 'Grant Type',
   'Amount Approved', 'Organisation Type', 'Organisation Name', 'Project Title',
   'Primary Contact Email', 'FY Folder URL', 'Organisation Folder URL', 'Grant Workspace URL',
   'Setup Folder URL', 'Setup Workbook URL',
   'Q1 Folder URL', 'Q2 Folder URL', 'Q3 Folder URL', 'Q4 Folder URL',
   'Supporting Documents Folder URL', 'Budget Allocation & Fund Utilisation Folder URL',
   'Disbursement Folder URL', 'Validation Status', 'Workspace Status', 'Sharing Status',
   'Current Step', 'Last Completed Step', 'Last Error Code', 'Last Error Message',
   'Retry Count', 'Created At', 'Last Updated At', 'Record Status',
   'Approved Setup Archive URL', 'Setup Shortcut URL', 'Workspace Notification Status',
   'Workspace Notification Sent At', 'Workspace Notification Recipient',
   'Outcome Progress Workbook URL', 'Disbursement Workbook URL',
   'Setup Review Status', 'Data Update Status', 'Data Sync Status',
   'Setup Last Modified At', 'Data Sync Attempt At', 'Data Synced At', 'Reviewed At', 'Reviewed By'
 ],
 ADMIN_TABLES: [
   {
     SHEET_NAME: '1. Workspace Creator', TABLE_NAME: 'WorkspaceCreator', MIN_ROWS: 500,
     COLUMNS: [
       { NAME: 'Financial Year', TYPE: 'DROPDOWN', VALUES: ['2026-27', '2027-28', '2028-29', '2029-30'] },
       { NAME: 'Grant Start Date', TYPE: 'DATE' },
       { NAME: 'Grant End Date', TYPE: 'DATE' },
       { NAME: 'Organisation Type', TYPE: 'DROPDOWN', VALUES: ['New Organisation', 'Returning Organisation'] },
       { NAME: 'Organisation Name', TYPE: 'COLUMN_TYPE_UNSPECIFIED' },
       { NAME: 'Thematic Area', TYPE: 'DROPDOWN', VALUES: ['Miscellaneous', 'Capacity Building', 'Education', 'Public Leadership', 'Social Justice', 'Health', 'Animal Welfare'] },
       { NAME: 'Thematic Sub-area', TYPE: 'DROPDOWN', VALUES: ['21st Century Skills', 'NA', 'Innovation', 'Personal Safety', 'Socio-Emotional Learning', 'Academics', 'Inclusion', 'Career Building', 'Early Childhood Education'] },
       { NAME: 'Proximity to Children / Beneficiary', TYPE: 'DROPDOWN', VALUES: ['Direct School Support', 'NA', 'After-School Support', 'Ecosystem Capacity Building - Entrepreneurs/Teachers', 'Ecosystem Capacity Building - State', 'Alternate School Support'] },
       { NAME: 'Grant Title', TYPE: 'TEXT' },
       { NAME: 'Grant Type', TYPE: 'DROPDOWN', VALUES: ['Restricted', 'Unrestricted', 'Transactional', 'Discretionary'] },
       { NAME: 'Amount Approved', TYPE: 'COLUMN_TYPE_UNSPECIFIED', FORMAT: 'INDIAN_CURRENCY' },
       { NAME: 'Primary Contact Email', TYPE: 'TEXT' },
       { NAME: 'Grant Status', TYPE: 'DROPDOWN', VALUES: ['Active', 'Discontinued', 'Complete'] },
       { NAME: 'Action', TYPE: 'DROPDOWN', VALUES: ['Create Workspace', 'Retry Workspace', 'Retry Sharing', 'Completed'] },
       { NAME: 'Duplicate?', TYPE: 'TEXT' },
       { NAME: 'Workspace Status', TYPE: 'TEXT' },
       { NAME: 'Organisation Workspace', TYPE: 'TEXT' },
       { NAME: 'Setup Workbook', TYPE: 'TEXT' },
       { NAME: 'Outcome, Support and Disbursement Tracker', TYPE: 'TEXT' },
       { NAME: 'Supporting & Compliance', TYPE: 'TEXT' },
       { NAME: 'Budget Allocation & Fund Utilisation', TYPE: 'TEXT' },
       { NAME: 'Setup Review Status', TYPE: 'DROPDOWN', VALUES: ['', 'Awaiting Review', 'Changes Required', 'Approved', 'Retry Approval', 'Locked & Migrated'] },
       { NAME: 'Progress Report Q1', TYPE: 'TEXT' },
       { NAME: 'Progress Report Q2', TYPE: 'TEXT' },
       { NAME: 'Progress Report Q3', TYPE: 'TEXT' },
       { NAME: 'Progress Report Q4', TYPE: 'TEXT' },
       { NAME: 'Disbursement Documents', TYPE: 'TEXT' },
       { NAME: 'Last Updated', TYPE: 'DATE_TIME' },
       { NAME: 'Request ID', TYPE: 'TEXT' },
       { NAME: 'Organisation ID', TYPE: 'TEXT' },
       { NAME: 'Grant ID', TYPE: 'TEXT' },
       { NAME: 'Workspace ID', TYPE: 'TEXT' }
     ]
   },
   {
     SHEET_NAME: '7. Organisation Maturity', TABLE_NAME: 'OrganisationMaturityTable',
     HEADER_ROW: 2, MIN_ROWS: 1000,
     COLUMNS: [
       { NAME: 'Financial Year', TYPE: 'TEXT' },
       { NAME: 'Grant ID', TYPE: 'TEXT' },
       { NAME: 'Organisation Name', TYPE: 'TEXT' },
       { NAME: 'Grant Title', TYPE: 'TEXT' },
       { NAME: 'Aspect', TYPE: 'DROPDOWN', DYNAMIC: 'MATURITY_ASPECTS' },
       { NAME: 'Indicator', TYPE: 'DROPDOWN', DYNAMIC: 'MATURITY_INDICATORS' },
       { NAME: 'Status', TYPE: 'DROPDOWN', DYNAMIC: 'MATURITY_STATUSES' }
     ]
   },
   {
     SHEET_NAME: '9. Organisation Registry', TABLE_NAME: 'OrganisationRegistry', MIN_ROWS: 500,
     COLUMNS: [
       { NAME: 'Organisation ID', TYPE: 'TEXT' }, { NAME: 'Organisation Name', TYPE: 'TEXT' },
       { NAME: 'Name as per Registration Certificate', TYPE: 'TEXT' },
       { NAME: 'Formal Legal Status', TYPE: 'TEXT' }, { NAME: 'Year of Registration', TYPE: 'DOUBLE' },
       { NAME: 'Mailing Address', TYPE: 'TEXT' }, { NAME: 'Website URL', TYPE: 'TEXT' },
       { NAME: 'Primary Contact Name', TYPE: 'TEXT' }, { NAME: 'Primary Contact Designation', TYPE: 'TEXT' },
       { NAME: 'Primary Contact Phone', TYPE: 'TEXT' }, { NAME: 'Primary Contact Email', TYPE: 'TEXT' },
       { NAME: 'CSR / UIN Number', TYPE: 'TEXT' }, { NAME: 'PAN Number', TYPE: 'TEXT' },
       { NAME: 'TAN Number', TYPE: 'TEXT' }, { NAME: 'Mission Statement', TYPE: 'TEXT' },
       { NAME: 'Vision Statement', TYPE: 'TEXT' }, { NAME: 'Geographical Presence', TYPE: 'TEXT' },
       { NAME: 'Code of Conduct Policy?', TYPE: 'DROPDOWN', VALUES: ['Yes', 'No'] },
       { NAME: 'POSH Policy?', TYPE: 'DROPDOWN', VALUES: ['Yes', 'No'] },
       { NAME: 'Child Protection Policy?', TYPE: 'DROPDOWN', VALUES: ['Yes', 'No'] },
       { NAME: 'Data Protection Policy?', TYPE: 'DROPDOWN', VALUES: ['Yes', 'No'] },
       { NAME: 'Other Policy', TYPE: 'TEXT' },
       { NAME: 'Human Resource SOP?', TYPE: 'DROPDOWN', VALUES: ['Yes', 'No'] },
       { NAME: 'Purchase & Procurement SOP?', TYPE: 'DROPDOWN', VALUES: ['Yes', 'No'] },
       { NAME: 'Finance & Accounting SOP?', TYPE: 'DROPDOWN', VALUES: ['Yes', 'No'] },
       { NAME: 'Other SOP', TYPE: 'TEXT' },
       { NAME: 'FCRA Registration Link', TYPE: 'TEXT' }, { NAME: 'Section 12A Registration Link', TYPE: 'TEXT' },
       { NAME: 'Section 80G Link', TYPE: 'TEXT' }, { NAME: 'PAN Card Link', TYPE: 'TEXT' },
       { NAME: 'TAN Card Link', TYPE: 'TEXT' }, { NAME: 'Latest Annual Report Link', TYPE: 'TEXT' },
       { NAME: 'Financial Audit Report Link', TYPE: 'TEXT' }, { NAME: 'CSR Registration Link', TYPE: 'TEXT' },
       { NAME: 'Registration Certificate Link', TYPE: 'TEXT' }, { NAME: 'Record Status', TYPE: 'TEXT' },
       { NAME: 'Source Setup Workbook URL', TYPE: 'TEXT' }, { NAME: 'Master Data Synced At', TYPE: 'DATE_TIME' },
       { NAME: 'Template Schema Version', TYPE: 'TEXT' },
       { NAME: 'FCRA Registration Expiry Date', TYPE: 'DATE' },
       { NAME: 'Section 12A Registration Expiry Date', TYPE: 'DATE' },
       { NAME: 'Section 80G Expiry Date', TYPE: 'DATE' }
     ]
   },
   {
     SHEET_NAME: '8. Grant Registry', TABLE_NAME: 'GrantRegistry', MIN_ROWS: 500,
     COLUMNS: [
       { NAME: 'Grant ID', TYPE: 'TEXT' }, { NAME: 'Financial Year', TYPE: 'TEXT' },
       { NAME: 'Grant Start Quarter', TYPE: 'DROPDOWN', VALUES: ['Q1 (Apr-Jun)', 'Q2 (Jul-Sep)', 'Q3 (Oct-Dec)', 'Q4 (Jan-Mar)'] },
       { NAME: 'Organisation ID', TYPE: 'TEXT' }, { NAME: 'Organisation Name', TYPE: 'TEXT' },
       { NAME: 'Thematic Area', TYPE: 'DROPDOWN', VALUES: ['Miscellaneous', 'Capacity Building', 'Education', 'Public Leadership', 'Social Justice', 'Health', 'Animal Welfare'] },
       { NAME: 'Thematic Sub-area', TYPE: 'DROPDOWN', VALUES: ['21st Century Skills', 'NA', 'Innovation', 'Personal Safety', 'Socio-Emotional Learning', 'Academics', 'Inclusion', 'Career Building', 'Early Childhood Education'] },
       { NAME: 'Proximity to Children / Beneficiary', TYPE: 'DROPDOWN', VALUES: ['Direct School Support', 'NA', 'After-School Support', 'Ecosystem Capacity Building - Entrepreneurs/Teachers', 'Ecosystem Capacity Building - State', 'Alternate School Support'] },
       { NAME: 'Project Title', TYPE: 'TEXT' }, { NAME: 'Grant Start Date', TYPE: 'DATE' },
       { NAME: 'Grant End Date', TYPE: 'DATE' },
       { NAME: 'Grant Type', TYPE: 'DROPDOWN', VALUES: ['Restricted', 'Unrestricted', 'Transactional', 'Discretionary'] },
       { NAME: 'Amount Approved', TYPE: 'COLUMN_TYPE_UNSPECIFIED', FORMAT: 'INDIAN_CURRENCY' },
       { NAME: 'Grant Status', TYPE: 'DROPDOWN', VALUES: ['Active', 'Discontinued', 'Complete'] },
       { NAME: 'Programme Status', TYPE: 'DROPDOWN', VALUES: ['Currently Operational', 'Starting Soon'] },
       { NAME: 'Years Implemented', TYPE: 'DOUBLE' }, { NAME: 'Project Duration (Months)', TYPE: 'DOUBLE' },
       { NAME: 'Total Project Budget', TYPE: 'COLUMN_TYPE_UNSPECIFIED', FORMAT: 'INDIAN_CURRENCY' }, { NAME: 'States Covered', TYPE: 'TEXT' },
       { NAME: 'Districts Covered', TYPE: 'TEXT' }, { NAME: 'Amount Requested', TYPE: 'COLUMN_TYPE_UNSPECIFIED', FORMAT: 'INDIAN_CURRENCY' },
       { NAME: 'Funds Raised from Other Sources?', TYPE: 'DROPDOWN', VALUES: ['Yes', 'No'] },
       { NAME: 'Other Funding Details', TYPE: 'TEXT' },
       { NAME: 'Other Funders Considering?', TYPE: 'DROPDOWN', VALUES: ['Yes', 'No'] },
       { NAME: 'Other Funders Considering Details', TYPE: 'TEXT' },
       { NAME: 'Bank Name', TYPE: 'TEXT' }, { NAME: 'Account Holder Name', TYPE: 'TEXT' },
       { NAME: 'Account Number', TYPE: 'TEXT' }, { NAME: 'IFSC Code', TYPE: 'TEXT' },
       { NAME: 'Itemised Budget Link', TYPE: 'TEXT' },
       { NAME: 'Problem Statement', TYPE: 'TEXT' }, { NAME: 'Visualising Success', TYPE: 'TEXT' },
       { NAME: 'Project Model / Key Features', TYPE: 'TEXT' }, { NAME: 'Scale Potential', TYPE: 'TEXT' },
       { NAME: 'Stakeholders', TYPE: 'TEXT' }, { NAME: 'Beneficiaries', TYPE: 'TEXT' },
       { NAME: 'Stakeholder / Community Consultation', TYPE: 'TEXT' },
       { NAME: 'Critical Partnerships / Relationships', TYPE: 'TEXT' },
       { NAME: 'Approach to Learning', TYPE: 'TEXT' }, { NAME: 'Team Size — Current FY', TYPE: 'DOUBLE' },
       { NAME: 'Employee Attrition — Current Snapshot', TYPE: 'DOUBLE' },
       { NAME: 'Attrition Context / Notes — Current Snapshot', TYPE: 'TEXT' },
       { NAME: 'Pending Cases / Complaints', TYPE: 'TEXT' },
       { NAME: 'Annual Budget — Current FY', TYPE: 'COLUMN_TYPE_UNSPECIFIED', FORMAT: 'INDIAN_CURRENCY' },
       { NAME: 'Annual Budget — Previous FY', TYPE: 'COLUMN_TYPE_UNSPECIFIED', FORMAT: 'INDIAN_CURRENCY' },
       { NAME: 'Annual Budget — Two FY Ago', TYPE: 'COLUMN_TYPE_UNSPECIFIED', FORMAT: 'INDIAN_CURRENCY' }, { NAME: 'Current Funders', TYPE: 'TEXT' },
       { NAME: 'Primary Contact Email', TYPE: 'TEXT' }, { NAME: 'Master Data Sync Status', TYPE: 'TEXT' },
       { NAME: 'Record Status', TYPE: 'TEXT' }, { NAME: 'Setup Created At', TYPE: 'DATE_TIME' },
       { NAME: 'Last Updated At', TYPE: 'DATE_TIME' }, { NAME: 'Source Setup Workbook URL', TYPE: 'TEXT' },
       { NAME: 'Master Data Synced At', TYPE: 'DATE_TIME' }, { NAME: 'Template Schema Version', TYPE: 'TEXT' },
       { NAME: 'Team Size — Previous FY', TYPE: 'DOUBLE' },
       { NAME: 'Employee Attrition — Previous Snapshot', TYPE: 'DOUBLE' },
       { NAME: 'Attrition Context / Notes — Previous Snapshot', TYPE: 'TEXT' },
       { NAME: 'Primary Beneficiary Group', TYPE: 'TEXT' },
       { NAME: 'Primary Beneficiary Count', TYPE: 'DOUBLE' }
     ]
   }
 ],
 REVIEW_STATUS: { AWAITING: 'Awaiting Review', CHANGES: 'Changes Required', APPROVED: 'Approved', RETRY: 'Retry Approval', LOCKED: 'Locked & Migrated' },
 DATA_UPDATE_STATUS: {
   NOT_READY: 'Not Ready', READY: 'Ready', UPDATING: 'Updating', UPDATED: 'Updated',
   FAILED: 'Failed', REOPEN_REQUIRED: 'Reopen Required'
 },
 STATUS: {
   VALIDATION_FAILED: 'Validation Failed', IN_PROGRESS: 'In Progress',
   NEEDS_ATTENTION: 'Needs Attention', WORKSPACE_CREATED: 'Workspace Created', REGISTRY_ONLY: 'Registry Only',
   SHARING_PENDING: 'Sharing Pending', COMPLETED: 'Completed', PENDING: 'Pending', FAILED: 'Failed'
 },
 STEP: {
   VALIDATED: 'Validated', ORGANISATION_RESOLVED: 'Organisation Resolved',
   FY_FOLDER_READY: 'FY Folder Ready', ORGANISATION_FOLDER_READY: 'Organisation Workspace Ready',
   SUBFOLDERS_READY: 'Submission Folders Ready', WORKBOOK_READY: 'Setup Workbook Ready',
   OUTCOME_WORKBOOK_READY: 'Outcome Progress Workbook Ready',
   WORKBOOK_CONFIGURED: 'Setup Workbook Configured', REGISTRIES_UPDATED: 'Registries Updated',
   SHARING: 'Sharing', NOTIFICATION: 'Workspace Notification', COMPLETED: 'Completed'
 },
 FOLDERS: {
   Q1: 'Progress Report Q1', Q2: 'Progress Report Q2', Q3: 'Progress Report Q3', Q4: 'Progress Report Q4',
   SUPPORTING: 'Supporting & Compliance Documents',
   BUDGET_UTILISATION: 'Budget Allocation & Fund Utilisation',
   DISBURSEMENT: 'Disbursement Documents', APPROVED_SETUPS: 'Approved Grant Setups'
 },
 EXECUTION_GUARD_MS: 270000,
 ACTIVE: 'Active'
});