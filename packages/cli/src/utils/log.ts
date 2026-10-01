/**
 * Whether output may carry ANSI colors. NO_COLOR (https://no-color.org)
 * turns them off when it is set to a non-empty value.
 */
function colorEnabled(): boolean {
  const noColor = process.env.NO_COLOR;
  return noColor === undefined || noColor === "";
}

/** An ANSI escape code, or "" when NO_COLOR is set. */
export function ansi(code: string): string {
  return colorEnabled() ? code : "";
}

const RESET = ansi("\x1b[0m");
const GREEN = ansi("\x1b[32m");
const RED = ansi("\x1b[31m");
const YELLOW = ansi("\x1b[33m");
const CYAN = ansi("\x1b[36m");
const BOLD = ansi("\x1b[1m");
const DIM = ansi("\x1b[2m");

let print = (line: string): void => console.log(line);

/**
 * Sends the messages of this module to stdout (the default) or stderr. A
 * command whose stdout is data, such as `scan --generate`, reports on stderr.
 */
export function setStream(stream: "stdout" | "stderr"): void {
  print = stream === "stderr" ? (line) => console.error(line) : (line) => console.log(line);
}

export function success(msg: string): void {
  print(`  ${GREEN}✓${RESET} ${msg}`);
}

export function fail(msg: string): void {
  print(`  ${RED}✗${RESET} ${msg}`);
}

export function warn(msg: string): void {
  print(`  ${YELLOW}!${RESET} ${msg}`);
}

export function info(msg: string): void {
  print(`  ${CYAN}i${RESET} ${msg}`);
}

export function heading(msg: string): void {
  print(`\n  ${BOLD}${msg}${RESET}\n`);
}

export function dim(msg: string): void {
  print(`  ${DIM}${msg}${RESET}`);
}

/** An empty line. */
export function blank(): void {
  print("");
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
    print(`  ${line}`);
  }
}
