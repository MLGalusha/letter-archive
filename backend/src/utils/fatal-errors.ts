interface FatalLogger {
  fatal(fields: { err: unknown }, message: string): void;
}

/** Observe fatal errors without overriding Node's nonzero termination. */
export function installFatalErrorLogging(log: FatalLogger): void {
  process.on('uncaughtExceptionMonitor', (err) => {
    log.fatal({ err }, 'Uncaught exception; terminating process');
  });
  // Make rejection termination explicit even if Node was launched in warn mode.
  process.on('unhandledRejection', (reason) => {
    throw reason instanceof Error ? reason : new Error('Unhandled rejection', { cause: reason });
  });
}
