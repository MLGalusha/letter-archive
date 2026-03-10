#!/usr/bin/env tsx

import process from 'node:process';
import { runQueryLogs } from '../src/utils/log-query-cli.js';

process.exitCode = runQueryLogs(process.argv.slice(2));
