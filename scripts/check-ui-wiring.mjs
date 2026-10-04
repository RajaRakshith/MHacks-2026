import { execFileSync } from 'node:child_process';

const needles = ['Protect this call', 'Simulate call', 'postRelay', 'AnalysisPanel', 'TryPage'];
let failed = false;
for (const n of needles) {
  let out = '';
  try {
    out = execFileSync('rg', ['-n', '--glob', '!**/node_modules/**', n, 'apps/web', 'apps/mobile'], {
      encoding: 'utf8',
    });
  } catch (e) {
    if (e.status === 1) continue;
    throw e;
  }
  if (out.trim()) {
    failed = true;
    console.error(`forbidden "${n}":\n${out}`);
  }
}
process.exit(failed ? 1 : 0);
