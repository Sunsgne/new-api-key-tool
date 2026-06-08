// 用量查询相关的辅助函数：日期处理、快捷区间、按日聚合等

export const TOKEN_REGEX = /^sk-[a-zA-Z0-9]{48}$/;

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function toUnixSeconds(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

export function formatDateYMD(timestampSeconds) {
  const d = new Date(timestampSeconds * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Semi DatePicker presets：今天/昨天/本周/上周/本月/上月
export function getDatePresets() {
  return [
    {
      text: '今天',
      start: startOfDay(new Date()),
      end: endOfDay(new Date()),
    },
    {
      text: '昨天',
      start: (() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return startOfDay(d);
      })(),
      end: (() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return endOfDay(d);
      })(),
    },
    {
      text: '本周',
      start: (() => {
        const e = new Date();
        const day = e.getDay() || 7; // 周一为一周起点
        const n = new Date(e);
        n.setDate(e.getDate() - day + 1);
        return startOfDay(n);
      })(),
      end: endOfDay(new Date()),
    },
    {
      text: '上周',
      start: (() => {
        const e = new Date();
        const day = e.getDay() || 7;
        const n = new Date(e);
        n.setDate(e.getDate() - day + 1 - 7);
        return startOfDay(n);
      })(),
      end: (() => {
        const e = new Date();
        const day = e.getDay() || 7;
        const n = new Date(e);
        n.setDate(e.getDate() - day + 1 - 1);
        return endOfDay(n);
      })(),
    },
    {
      text: '本月',
      start: (() => {
        const e = new Date();
        return startOfDay(new Date(e.getFullYear(), e.getMonth(), 1));
      })(),
      end: endOfDay(new Date()),
    },
    {
      text: '上月',
      start: (() => {
        const e = new Date();
        return startOfDay(new Date(e.getFullYear(), e.getMonth() - 1, 1));
      })(),
      end: (() => {
        const e = new Date();
        return endOfDay(new Date(e.getFullYear(), e.getMonth(), 0));
      })(),
    },
  ];
}

// 按日 + 模型 + 令牌名称聚合调用日志
export function aggregateLogsByDay(logs) {
  const map = new Map();
  for (const log of logs) {
    // 只统计消费类日志（type 0/2）
    if (log.type !== undefined && log.type !== 0 && log.type !== 2) continue;
    const date = formatDateYMD(log.created_at);
    const key = `${date}|${log.model_name || ''}|${log.token_name || ''}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        date,
        model_name: log.model_name || '',
        token_name: log.token_name || '',
        count: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        quota: 0,
      });
    }
    const row = map.get(key);
    row.count += 1;
    row.prompt_tokens += log.prompt_tokens || 0;
    row.completion_tokens += log.completion_tokens || 0;
    row.quota += log.quota || 0;
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.quota - a.quota;
  });
}

export function maskToken(token) {
  if (!token || token.length < 12) return token;
  return `${token.slice(0, 6)}****${token.slice(-4)}`;
}
