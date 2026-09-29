/** Consistent, greppable stage logging. No colour codes — these logs get pasted into issues. */

let failures = 0;

export function stage(n: string, title: string): void {
  console.log('');
  console.log(`━━ stage ${n} ── ${title}`);
}

export function info(msg: string): void {
  console.log(`   ${msg}`);
}

export function ok(msg: string): void {
  console.log(`   ✓ ${msg}`);
}

export function warn(msg: string): void {
  console.log(`   ! ${msg}`);
}

export function bad(msg: string): void {
  failures += 1;
  console.log(`   ✗ ${msg}`);
}

export function failureCount(): number {
  return failures;
}

export function table(rows: string[][]): void {
  if (rows.length === 0) return;
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  for (const row of rows) {
    console.log('   ' + row.map((c, i) => (c ?? '').padEnd(widths[i])).join('  '));
  }
}

/**
 * Aborts the run. Every stage uses this rather than throwing, so the operator always gets
 * a reason and a remedy rather than a stack trace.
 */
export function die(msg: string, remedy?: string): never {
  console.error('');
  console.error(`FAILED: ${msg}`);
  if (remedy) {
    console.error('');
    console.error(remedy);
  }
  console.error('');
  process.exit(1);
}
