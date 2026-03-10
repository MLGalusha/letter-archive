import { LOG_DIR } from './logger.js';
import {
  LOG_LEVEL_VALUES,
  filterLogEntries,
  formatLogEntry,
  readLogEntries,
  type LogLevelName,
} from './log-query.js';

export interface CliOptions {
  logDir: string;
  requestId?: string;
  hours: number;
  level?: LogLevelName;
  path?: string;
  text?: string;
  limit: number;
  json: boolean;
  help: boolean;
}

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now: () => number;
}

export const defaultCliIo: CliIo = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
  now: () => Date.now(),
};

export function buildHelpText(): string {
  return `Usage: npm run logs:query -- [options]

Options:
  --request-id <id>   Filter by x-request-id / requestId
  --hours <n>         Show only entries from the last n hours (default: 24)
  --level <level>     Minimum level: ${Object.keys(LOG_LEVEL_VALUES).join(', ')}
  --path <path>       Filter by request path
  --text <text>       Case-insensitive text search across each log entry
  --limit <n>         Maximum number of matching entries to print (default: 100)
  --json              Print raw NDJSON objects instead of formatted lines
  --log-dir <dir>     Override the log directory
  --help              Show this help

Examples:
  npm run logs:query -- --level error --hours 24
  npm run logs:query -- --request-id 123e4567-e89b-12d3-a456-426614174000
  npm run logs:query -- --path /admin/letters/abc/flag --hours 6`;
}

export function printHelp(io: Pick<CliIo, 'stdout'> = defaultCliIo): void {
  io.stdout(buildHelpText());
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    logDir: LOG_DIR,
    hours: 24,
    limit: 100,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    const readValue = (flag: string): string => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${flag}`);
      }
      index += 1;
      return value;
    };

    switch (token) {
      case '--request-id':
        options.requestId = readValue(token);
        break;
      case '--hours':
        options.hours = Number(readValue(token));
        break;
      case '--level': {
        const level = readValue(token);
        if (!(level in LOG_LEVEL_VALUES)) {
          throw new Error(`Invalid level "${level}"`);
        }
        options.level = level as LogLevelName;
        break;
      }
      case '--path':
        options.path = readValue(token);
        break;
      case '--text':
        options.text = readValue(token);
        break;
      case '--limit':
        options.limit = Number(readValue(token));
        break;
      case '--log-dir':
        options.logDir = readValue(token);
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option "${token}"`);
    }
  }

  if (!Number.isFinite(options.hours) || options.hours <= 0) {
    throw new Error('hours must be a positive number');
  }

  if (!Number.isFinite(options.limit) || options.limit <= 0) {
    throw new Error('limit must be a positive number');
  }

  return options;
}

export function runQueryLogs(argv: string[], io: CliIo = defaultCliIo): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(message);
    io.stderr('Run with --help for usage.');
    return 1;
  }

  if (options.help) {
    printHelp(io);
    return 0;
  }

  const sinceTime = io.now() - (options.hours * 60 * 60 * 1000);
  const entries = filterLogEntries(readLogEntries(options.logDir), {
    requestId: options.requestId,
    path: options.path,
    text: options.text,
    minLevel: options.level,
    sinceTime,
    limit: options.limit,
  });

  if (entries.length === 0) {
    io.stderr(`No matching log entries in ${options.logDir}`);
    return 1;
  }

  for (const entry of entries) {
    if (options.json) {
      io.stdout(JSON.stringify(entry.raw));
      continue;
    }

    io.stdout(formatLogEntry(entry));
  }

  return 0;
}
