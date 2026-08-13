/**
 * Structured Logger
 * Provides consistent, JSON-formatted logging for observability at scale.
 * Drop-in compatible with existing console.log usage.
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? LOG_LEVELS.info;

function formatMessage(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  const base = {
    timestamp,
    level,
    message: typeof message === 'string' ? message : JSON.stringify(message),
  };

  // Add context fields
  if (context.error instanceof Error) {
    context.error = {
      name: context.error.name,
      message: context.error.message,
      stack: context.error.stack,
    };
  }

  // Add request context if available
  if (context.req) {
    context.requestId = context.req.id || context.req.headers?.['x-request-id'];
    context.method = context.req.method;
    context.path = context.req.path;
    context.locationId = context.req.params?.locationId || context.req.body?.locationId;
    context.agentId = context.req.params?.agentId || context.req.body?.agentId;
    delete context.req;
  }

  return { ...base, ...context };
}

function shouldLog(level) {
  return LOG_LEVELS[level] <= currentLevel;
}

function log(level, message, context = {}) {
  if (!shouldLog(level)) return;

  const formatted = formatMessage(level, message, context);

  // In production, output JSON for log aggregators
  if (process.env.NODE_ENV === 'production') {
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
      JSON.stringify(formatted)
    );
  } else {
    // In development, keep human-readable format
    const colorCode = {
      error: '\x1b[31m',
      warn: '\x1b[33m',
      info: '\x1b[36m',
      debug: '\x1b[90m',
    }[level];
    const reset = '\x1b[0m';
    const contextStr = Object.keys(context).length > 0
      ? ` ${JSON.stringify(context)}`
      : '';
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
      `${colorCode}[${level.toUpperCase()}]${reset} ${formatted.timestamp} ${message}${contextStr}`
    );
  }
}

export const logger = {
  error: (message, context = {}) => log('error', message, context),
  warn: (message, context = {}) => log('warn', message, context),
  info: (message, context = {}) => log('info', message, context),
  debug: (message, context = {}) => log('debug', message, context),

  // Helper for timing operations
  time: (label) => {
    const start = process.hrtime.bigint();
    return {
      end: (context = {}) => {
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1_000_000;
        log('info', `${label} completed`, { ...context, durationMs });
        return durationMs;
      },
    };
  },

  // Child logger with preset context
  child: (defaultContext) => ({
    error: (message, context = {}) => log('error', message, { ...defaultContext, ...context }),
    warn: (message, context = {}) => log('warn', message, { ...defaultContext, ...context }),
    info: (message, context = {}) => log('info', message, { ...defaultContext, ...context }),
    debug: (message, context = {}) => log('debug', message, { ...defaultContext, ...context }),
  }),
};

export default logger;
