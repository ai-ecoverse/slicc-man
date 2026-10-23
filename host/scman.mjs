#!/usr/bin/env node
import { isatty } from 'node:tty';
import { main } from './main.mjs';

const tty = isatty(1);
process.exitCode = await main({
  name: 'scman',
  argv: process.argv.slice(2),
  env: process.env,
  platform: process.platform,
  fds: [0, 1, 2],
  tty,
  columns: tty ? process.stdout.columns : undefined,
});
