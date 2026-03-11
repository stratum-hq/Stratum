import * as readline from "readline";

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await ask(`${question} ${hint} `);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

export async function select(question: string, options: string[]): Promise<number> {
  console.log(`\n  ${question}\n`);
  options.forEach((opt, i) => {
    console.log(`    ${i + 1}) ${opt}`);
  });
  console.log();
  const answer = await ask("  Choice: ");
  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= options.length) {
    console.error("  Invalid selection.");
    process.exit(1);
  }
  return idx;
}
