export const frontendDashboardTasks = [
  {
    id: 'FE-001',
    title: 'Dashboard shell and navigation',
    implementation: [
      'Create the responsive application shell.',
      'Add Dashboard, Run Details, and Settings routes.',
      'Provide keyboard-accessible navigation and a visible page heading.',
    ],
    acceptance: [
      'All three routes render without a blank page.',
      'Unknown routes redirect to the dashboard.',
      'Navigation remains usable on mobile and desktop.',
    ],
    regressionTest: 'FE-001: routes and page modules exist',
  },
  {
    id: 'FE-002',
    title: 'Automation configuration form',
    implementation: [
      'Capture sheet ID, sheet name, batch size, concurrency, timeout, browser mode, and dry-run mode.',
      'Validate inputs before a run can start.',
      'Keep live submission disabled by default.',
    ],
    acceptance: [
      'Required settings display validation errors.',
      'Batch size and concurrency accept only safe numeric ranges.',
      'Dry-run mode is the default.',
    ],
    regressionTest: 'FE-002: configuration component and environment contract exist',
  },
  {
    id: 'FE-003',
    title: 'Contact profile form',
    implementation: [
      'Provide fields for identity, organization, address, phone, email, and approved message.',
      'Validate email, phone, and required fields.',
      'Prevent secrets from being entered or displayed in this form.',
    ],
    acceptance: [
      'Profile values can be reviewed and edited.',
      'Invalid email and missing required values block saving.',
      'The form never renders API credentials.',
    ],
    regressionTest: 'FE-003: contact profile component exists',
  },
  {
    id: 'FE-004',
    title: 'Run control panel',
    implementation: [
      'Add start, pause, resume, and stop controls.',
      'Require confirmation before a live submission run.',
      'Disable controls that are invalid for the current run state.',
    ],
    acceptance: [
      'Only valid controls are enabled for each state.',
      'Starting live mode requires explicit confirmation.',
      'Repeated clicks do not create duplicate commands.',
    ],
    regressionTest: 'FE-004: control panel and automation hook exist',
  },
  {
    id: 'FE-005',
    title: 'Live progress and summary',
    implementation: [
      'Subscribe to backend progress events.',
      'Show total, pending, processing, success, failed, manual-review, and skipped counts.',
      'Reconnect safely after a temporary connection failure.',
    ],
    acceptance: [
      'Counters update without refreshing the page.',
      'Disconnected state is visible to the operator.',
      'Event reconnection does not duplicate totals.',
    ],
    regressionTest: 'FE-005: progress component and live-progress hook exist',
  },
  {
    id: 'FE-006',
    title: 'Results table and filtering',
    implementation: [
      'Display URL, status, reason, timestamp, run ID, attempt count, and contact-page URL.',
      'Add status filtering, text search, and stable empty/loading states.',
      'Expose safe retry and manual-review actions.',
    ],
    acceptance: [
      'All supported statuses have readable labels.',
      'Filtering never mutates the original result collection.',
      'Empty, loading, and error states are distinguishable.',
    ],
    regressionTest: 'FE-006: results table and status badge exist',
  },
  {
    id: 'FE-007',
    title: 'Screenshot evidence viewer',
    implementation: [
      'Open result screenshots in an accessible modal.',
      'Show missing-image and loading states.',
      'Close by button, Escape key, or backdrop action.',
    ],
    acceptance: [
      'The modal traps focus while open.',
      'Escape closes the modal.',
      'Missing screenshots do not break the results page.',
    ],
    regressionTest: 'FE-007: screenshot modal exists',
  },
  {
    id: 'FE-008',
    title: 'API client and error handling',
    implementation: [
      'Centralize backend HTTP requests.',
      'Handle JSON, empty responses, timeouts, and server errors.',
      'Expose operator-friendly messages without leaking credentials.',
    ],
    acceptance: [
      'Non-success responses reject with a useful error.',
      'The base URL comes from the frontend environment.',
      'Network failures are displayed without crashing the dashboard.',
    ],
    regressionTest: 'FE-008: API client and API environment variable exist',
  },
  {
    id: 'FE-009',
    title: 'Responsive and accessible UI quality',
    implementation: [
      'Support keyboard navigation, visible focus, semantic labels, and sufficient contrast.',
      'Support phone, tablet, and desktop layouts.',
      'Respect reduced-motion preferences.',
    ],
    acceptance: [
      'Primary workflows work using only a keyboard.',
      'No horizontal page overflow at common mobile widths.',
      'Controls have programmatic names and visible focus styles.',
    ],
    regressionTest: 'FE-009: global responsive stylesheet exists',
  },
];
