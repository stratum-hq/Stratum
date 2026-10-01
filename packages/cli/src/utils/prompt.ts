import * as readline from "readline";

/**
 * One readline interface serves every prompt of a command. An interface per
 * question would lose the answers it had buffered from a pipe when it closes.
 */
let rl: readline.Interface | undefined;
const pending: string[] = [];
let closed = false;
let waiter: ((line: string | null) => void) | undefined;

function input(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on("line", (line) => {
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve(line);
      } else {
        pending.push(line);
      }
    });
    rl.on("close", () => {
      closed = true;
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve(null);
      }
    });
  }
  return rl;
}

/** Closes the prompt input. Commands that asked nothing are unaffected. */
export function closePrompt(): void {
  rl?.close();
  rl = undefined;
  pending.length = 0;
  closed = false;
  waiter = undefined;
}

/**
 * Asks a question and returns the trimmed answer. Rejects when stdin closes
 * before an answer arrives, so that a command run without input fails
 * instead of exiting 0 with nothing done.
 */
export async function ask(question: string): Promise<string> {
  const iface = input();
  let line: string | null;
  if (pending.length > 0) {
    process.stdout.write(question);
    line = pending.shift() as string;
  } else if (closed) {
    process.stdout.write(question);
    line = null;
  } else {
    iface.setPrompt(question);
    iface.prompt();
    line = await new Promise<string | null>((resolve) => {
      waiter = resolve;
    });
  }
  // A paused interface does not keep the process alive between questions.
  if (!closed) iface.pause();
  if (line === null) {
    process.stdout.write("\n");
    throw new Error(
      "Input closed before an answer was given. Run the command in a terminal, or pipe in an answer for every prompt.",
    );
  }
  // A terminal echoes the answer and its newline; piped input does not.
  if (!process.stdin.isTTY) process.stdout.write("\n");
  return line.trim();
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await ask(`${question} ${hint} `);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

/**
 * Asks for one of `options` by number. With `defaultIndex`, an empty answer
 * (Enter) picks that option.
 */
export async function select(question: string, options: string[], defaultIndex?: number): Promise<number> {
  console.log(`\n  ${question}\n`);
  options.forEach((opt, i) => {
    console.log(`    ${i + 1}) ${opt}`);
  });
  console.log();
  const hint = defaultIndex === undefined ? "" : ` [${defaultIndex + 1}]`;
  const answer = await ask(`  Choice${hint}: `);
  if (!answer && defaultIndex !== undefined) return defaultIndex;
  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= options.length) {
    console.error("  Invalid selection.");
    process.exit(1);
  }
  return idx;
}
