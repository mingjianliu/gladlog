function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const days = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  const maxDays = days[month - 1];
  if (maxDays === undefined) return false;
  return day >= 1 && day <= maxDays;
}

// Cache for Intl.DateTimeFormat instances per timezone
const formatterCache = new Map<string | undefined, Intl.DateTimeFormat>();



function getFormatter(timezone: string | undefined): Intl.DateTimeFormat {
  if (formatterCache.has(timezone)) {
    return formatterCache.get(timezone)!;
  }

  const formatterOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
    hourCycle: "h23",
  };
  if (timezone !== undefined) {
    formatterOptions.timeZone = timezone;
  }
  const formatter = new Intl.DateTimeFormat("en-US", formatterOptions);
  formatterCache.set(timezone, formatter);
  return formatter;
}

export function parseTimestamp(
  datePart: string,
  opts?: { timezone?: string },
): number | null {
  const match = datePart.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{1,2}):(\d{1,2})\.(\d{1,6})(?:([+-]\d+(?:\.\d+)?))?$/,
  );
  if (!match) return null;

  const month = parseInt(match[1]!, 10);
  const day = parseInt(match[2]!, 10);
  const year = parseInt(match[3]!, 10);
  const hour = parseInt(match[4]!, 10);
  const minute = parseInt(match[5]!, 10);
  const second = parseInt(match[6]!, 10);
  const fractionStr = match[7]!;
  const suffix = match[8];

  if (!isValidDate(year, month, day)) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  if (second < 0 || second > 59) return null;

  const ms = parseInt(
    fractionStr.length >= 3
      ? fractionStr.slice(0, 3)
      : fractionStr.padEnd(3, "0"),
    10,
  );

  if (suffix !== undefined) {
    const offset = parseFloat(suffix);
    const W_target = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    return W_target - offset * 3600000;
  }

  const timezone = opts?.timezone;

  try {
    const W_target = Date.UTC(year, month - 1, day, hour, minute, second, ms);

    let u = W_target;
    const formatter = getFormatter(timezone);
    for (let i = 0; i < 3; i++) {
      const parts = formatter.formatToParts(new Date(u));
      let pYear = 0,
        pMonth = 0,
        pDay = 0,
        pHour = 0,
        pMinute = 0,
        pSecond = 0;
      for (const part of parts) {
        switch (part.type) {
          case "year":
            pYear = parseInt(part.value, 10);
            break;
          case "month":
            pMonth = parseInt(part.value, 10);
            break;
          case "day":
            pDay = parseInt(part.value, 10);
            break;
          case "hour":
            pHour = parseInt(part.value, 10);
            break;
          case "minute":
            pMinute = parseInt(part.value, 10);
            break;
          case "second":
            pSecond = parseInt(part.value, 10);
            break;
        }
      }
      if (pHour === 24) pHour = 0;

      const w = Date.UTC(pYear, pMonth - 1, pDay, pHour, pMinute, pSecond, ms);
      const diff = w - W_target;
      if (diff === 0) {
        return u;
      }
      u -= diff;
    }
    return u;
  } catch {
    return null;
  }
}
