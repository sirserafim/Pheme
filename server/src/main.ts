import { runDev } from './commands/dev.ts';

// exitCode instead of process.exit(): pending log writes and handles finish before Node exits.
process.exitCode = await runDev({
  env: process.env,
  signals: process,
  exit: (code) => process.exit(code),
});
