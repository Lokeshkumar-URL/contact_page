import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['--test', 'tests/frontend-dashboard.regression.test.js'],
  { cwd: process.cwd(), encoding: 'utf8', stdio: 'inherit' },
);

if (result.error) {
  console.error(`Unable to start frontend regression tests: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
