const DATABASE_ERROR_PATTERN = /access denied|econnrefused|etimedout|database|mysql|tidb/i;

class SlidingWindowRegistry {
  constructor(options = {}) {
    this.maxKeys = Math.max(1, Number(options.maxKeys) || 5000);
    this.maxEventsPerKey = Math.max(1, Number(options.maxEventsPerKey) || 120);
    this.entries = new Map();
  }

  get size() {
    return this.entries.size;
  }

  recent(key, now, windowMs) {
    const events = (this.entries.get(String(key)) || []).filter((time) => now - time < windowMs);
    if (!events.length) {
      this.entries.delete(String(key));
      return [];
    }
    this.entries.delete(String(key));
    this.entries.set(String(key), events);
    return events;
  }

  record(key, now, windowMs) {
    const normalizedKey = String(key);
    const events = this.recent(normalizedKey, now, windowMs);
    events.push(now);
    this.entries.delete(normalizedKey);
    this.entries.set(normalizedKey, events.slice(-this.maxEventsPerKey));
    while (this.entries.size > this.maxKeys) {
      this.entries.delete(this.entries.keys().next().value);
    }
    return events.length;
  }

  delete(key) {
    return this.entries.delete(String(key));
  }

  prune(now, windowMs) {
    for (const [key, events] of this.entries) {
      const recent = events.filter((time) => now - time < windowMs);
      if (recent.length) this.entries.set(key, recent.slice(-this.maxEventsPerKey));
      else this.entries.delete(key);
    }
  }
}

function publicRequestError(error, production) {
  const rawStatus = Number(error && error.statusCode);
  const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
  const rawMessage = String((error && error.message) || "Unknown server error");
  if (DATABASE_ERROR_PATTERN.test(rawMessage)) {
    return { status: 503, message: "数据库服务暂时不可用，请稍后重试" };
  }
  if (status >= 500 && production) {
    return { status, message: "服务器暂时无法处理请求，请稍后重试" };
  }
  return { status, message: rawMessage };
}

module.exports = {
  DATABASE_ERROR_PATTERN,
  SlidingWindowRegistry,
  publicRequestError
};
