#!/usr/bin/env node

// The bin calls main() without a check on process.argv[1]. npm runs the bin
// through a symlink, so a compare of argv[1] with the module path is false.
import { main } from "./index.js";

main(process.argv.slice(2));
