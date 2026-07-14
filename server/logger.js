const SERVICE = process.env.LOG_SERVICE || "rc-car-cloud-server";

function normalizeMeta(meta = {}) {
  const normalized = {
    timestamp: new Date().toISOString(),
    service: SERVICE,
    pid: process.pid,
    vehicleId: meta.vehicleId ?? null,
    clientType: meta.clientType ?? null,
    connectionId: meta.connectionId ?? null,
    event: meta.event ?? "unknown",
    ...meta,
  };

  return normalized;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      level: "error",
      timestamp: new Date().toISOString(),
      service: SERVICE,
      pid: process.pid,
      event: "logger.serialize_failed",
    });
  }
}

function write(level, meta = {}) {
  const payload = {
    level,
    ...normalizeMeta(meta),
  };

  const line = `${safeJson(payload)}\n`;
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(line);
}

function info(meta) {
  write("info", meta);
}

function warn(meta) {
  write("warn", meta);
}

function error(meta) {
  write("error", meta);
}

module.exports = {
  info,
  warn,
  error,
};