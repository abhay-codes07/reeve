/**
 * Structured logging for Reeve, built on pino.
 *
 * This is the observability base every tool, agent, and workflow logs through.
 * Logs are JSON by default (machine-ingestible); in development they can be
 * pretty-printed by setting `REEVE_LOG_PRETTY=1`.
 *
 * The central idea is the {@link OperationLogger}: a child logger bound to an
 * `operation` (e.g. `github.issues.list`) plus arbitrary context, so every line
 * emitted within that operation carries the same correlation fields.
 */

import { pino, type Logger as PinoLogger, type Level, type LevelWithSilent } from 'pino';

/** Fields bound to every log line within an operation. */
export interface LogContext {
  /** Dotted operation name, e.g. `github.pulls.get` or `agent.orchestrator`. */
  operation?: string;
  /** Correlation id linking a chain of operations across a single task. */
  correlationId?: string;
  [key: string]: unknown;
}

export type Logger = PinoLogger;

function resolveLevel(): LevelWithSilent {
  const fromEnv = process.env.REEVE_LOG_LEVEL?.toLowerCase();
  const valid: Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  if (fromEnv && (valid as string[]).includes(fromEnv)) return fromEnv as Level;
  return process.env.NODE_ENV === 'test' ? 'silent' : 'info';
}

function buildRootLogger(): Logger {
  const level = resolveLevel();
  const pretty = process.env.REEVE_LOG_PRETTY === '1';

  return pino({
    level,
    base: { service: 'reeve' },
    // Stable, sortable timestamps.
    timestamp: pino.stdTimeFunctions.isoTime,
    // Never let a token or key reach the logs.
    redact: {
      paths: [
        'token',
        '*.token',
        'auth',
        '*.auth',
        'authorization',
        '*.authorization',
        'headers.authorization',
        'apiKey',
        '*.apiKey',
      ],
      censor: '[redacted]',
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

/** The process-wide root logger. Prefer {@link createOperationLogger} for work. */
export const rootLogger: Logger = buildRootLogger();

/**
 * Create a child logger bound to an operation and context. Every line it emits
 * carries those fields, giving traceable, correlated structured logs.
 */
export function createOperationLogger(context: LogContext, parent: Logger = rootLogger): Logger {
  return parent.child(context);
}

/**
 * Wrap an async operation with automatic start/success/failure logging and
 * duration measurement. Returns the operation's result; re-throws on failure
 * after logging. The bound logger is passed to the operation so nested calls
 * can keep the same context.
 */
export async function withOperation<T>(
  context: LogContext,
  fn: (log: Logger) => Promise<T>,
  parent: Logger = rootLogger,
): Promise<T> {
  const log = createOperationLogger(context, parent);
  const start = performance.now();
  log.debug('operation.start');
  try {
    const result = await fn(log);
    log.info({ durationMs: Math.round(performance.now() - start) }, 'operation.success');
    return result;
  } catch (err) {
    log.error(
      {
        durationMs: Math.round(performance.now() - start),
        err,
      },
      'operation.failure',
    );
    throw err;
  }
}
