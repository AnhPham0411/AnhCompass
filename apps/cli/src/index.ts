import { Command } from 'commander';
import { registerCompile } from './commands/compile.js';
import { registerDoctor } from './commands/doctor.js';
import { registerIntentNew } from './commands/intent-new.js';
import { registerCheck } from './commands/check.js';
import { registerInit } from './commands/init.js';

/** Kept in step with apps/cli/package.json by hand: the bundle has no
 *  package.json beside it to read at runtime. */
const CLI_VERSION = '0.1.0';

const program = new Command();

program
  .name('anhcompass')
  .description('Intent & drift layer for coding agents')
  .version(CLI_VERSION);

registerCompile(program);
registerDoctor(program);
registerIntentNew(program);
registerCheck(program);
registerInit(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
