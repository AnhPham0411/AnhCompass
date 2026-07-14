import { Command } from 'commander';
import { registerCompile } from './commands/compile.js';
import { registerDoctor } from './commands/doctor.js';
import { registerIntentNew } from './commands/intent-new.js';
import { registerCheck } from './commands/check.js';

const program = new Command();

program
  .name('anhcompass')
  .description('Intent & drift layer for coding agents')
  .version('0.0.1');

registerCompile(program);
registerDoctor(program);
registerIntentNew(program);
registerCheck(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
