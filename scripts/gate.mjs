// Pipeline gate runner. Invoked locally and (optionally) by CI.
// Runs type-check + lint + build sequentially with short status lines.
// Exits non-zero on the first failing stage.

import { spawn } from 'node:child_process';

const stages = [
  { name: 'type-check', cmd: 'npm', args: ['run', '-s', 'type-check'] },
  { name: 'lint',       cmd: 'npm', args: ['run', '-s', 'lint'] },
  { name: 'build',      cmd: 'npm', args: ['run', '-s', 'build'] },
];

function run(stage) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(stage.cmd, stage.args, { stdio: 'inherit' });
    p.on('close', (code) => resolve({ ...stage, code, ms: Date.now() - t0 }));
  });
}

let failed = false;
for (const stage of stages) {
  process.stdout.write(`\n— gate: ${stage.name} —\n`);
  const r = await run(stage);
  if (r.code !== 0) {
    process.stdout.write(`✗ ${stage.name} failed in ${r.ms}ms\n`);
    failed = true;
    break;
  }
  process.stdout.write(`✓ ${stage.name} passed in ${r.ms}ms\n`);
}

process.exit(failed ? 1 : 0);
