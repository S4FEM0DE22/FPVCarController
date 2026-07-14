type LogLevel = "debug" | "info" | "warn" | "error";

type LogMethod = (message: string, meta?: Record<string, unknown>) => void;

const isDevelopment = process.env.NODE_ENV !== "production";

function shouldLog(level: LogLevel) {
  if (level === "debug") return isDevelopment;
  return true;
}

function write(
  level: LogLevel,
  scope: string,
  message: string,
  meta: Record<string, unknown> = {}
) {
  if (!shouldLog(level)) return;

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...meta,
  };

  const line = JSON.stringify(payload);

  if (level === "debug") {
    console.debug(line);
    return;
  }

  if (level === "info") {
    console.info(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.error(line);
}

function createMethod(scope: string, level: LogLevel): LogMethod {
  return (message: string, meta: Record<string, unknown> = {}) => {
    write(level, scope, message, meta);
  };
}

export function createLogger(scope: string) {
  return {
    debug: createMethod(scope, "debug"),
    info: createMethod(scope, "info"),
    warn: createMethod(scope, "warn"),
    error: createMethod(scope, "error"),
  };
}
