const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export function success(msg: string): void {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

export function fail(msg: string): void {
  console.log(`  ${RED}✗${RESET} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`  ${YELLOW}!${RESET} ${msg}`);
}

export function info(msg: string): void {
  console.log(`  ${CYAN}i${RESET} ${msg}`);
}

export function heading(msg: string): void {
  console.log(`\n  ${BOLD}${msg}${RESET}\n`);
}

export function dim(msg: string): void {
  console.log(`  ${DIM}${msg}${RESET}`);
}

export function table(rows: string[][]): void {
  if (rows.length === 0) return;
  const colWidths = rows[0].map((_, colIdx) =>
    Math.max(...rows.map((row) => (row[colIdx] || "").length))
  );
  for (const row of rows) {
    const line = row
      .map((cell, i) => cell.padEnd(colWidths[i]))
      .join("  ");
    console.log(`  ${line}`);
  }
}
