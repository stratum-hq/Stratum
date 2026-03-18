#!/usr/bin/env node

import { parseArgs } from "./utils/args.js";
import { printHelp } from "./commands/help.js";
import { init } from "./commands/init.js";
import { migrate } from "./commands/migrate.js";
import { health } from "./commands/health.js";
import { generateApiKey } from "./commands/generate.js";
import { scaffold } from "./commands/scaffold.js";
import { doctor } from "./commands/doctor.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Handle top-level flags before parsing
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log("@stratum-hq/cli v0.1.0");
    return;
  }
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const { command, args, flags } = parseArgs(argv);

  try {
    switch (command) {
      case "init":
        await init(flags);
        break;
      case "migrate":
        await migrate(args, flags);
        break;
      case "health":
        await health(flags);
        break;
      case "generate":
        if (args[0] === "api-key") {
          await generateApiKey(flags);
        } else {
          console.error(`Unknown generate target: ${args[0]}`);
          console.error('Usage: stratum generate api-key [--name <name>]');
          process.exit(1);
        }
        break;
      case "scaffold":
        await scaffold(args, flags);
        break;
      case "doctor":
        await doctor(flags);
        break;
      case "help":
      case "--help":
      case "-h":
        printHelp();
        break;
      case "version":
      case "--version":
      case "-v":
        console.log("@stratum-hq/cli v0.1.0");
        break;
      default:
        if (command) {
          console.error(`Unknown command: ${command}`);
          console.error('Run "stratum help" for usage.');
        } else {
          printHelp();
        }
        process.exit(command ? 1 : 0);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n  Error: ${message}\n`);
    process.exit(1);
  }
}

main();
