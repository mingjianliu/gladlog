import fs from "fs-extra";
import path from "path";

export function parseCsv(text: string): {
  header: string[];
  rows: Record<string, string>[];
} {
  if (!text || !text.trim()) {
    return { header: [], rows: [] };
  }

  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  let i = 0;
  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ",") {
        currentRow.push(currentField);
        currentField = "";
        i++;
      } else if (char === "\r" || char === "\n") {
        currentRow.push(currentField);
        currentField = "";
        lines.push(currentRow);
        currentRow = [];
        if (char === "\r" && i + 1 < text.length && text[i + 1] === "\n") {
          i += 2;
        } else {
          i++;
        }
      } else {
        currentField += char;
        i++;
      }
    }
  }

  if (
    currentRow.length > 0 ||
    currentField !== "" ||
    (text.length > 0 && text[text.length - 1] === ",")
  ) {
    currentRow.push(currentField);
    lines.push(currentRow);
  }

  if (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (
      last.length === 1 &&
      last[0] === "" &&
      text[text.length - 1] !== '"' &&
      text[text.length - 1] !== ","
    ) {
      lines.pop();
    }
  }

  if (lines.length === 0) {
    return { header: [], rows: [] };
  }

  const header = lines[0];
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < lines.length; r++) {
    const rowData = lines[r];
    if (rowData.length === 1 && rowData[0] === "" && header.length > 1) {
      continue;
    }
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]] = rowData[c] !== undefined ? rowData[c] : "";
    }
    rows.push(row);
  }

  return { header, rows };
}

export async function fetchLatestBuild(): Promise<string> {
  const url = "https://wago.tools/api/builds?branch=retail&product=wow";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch build list: ${res.statusText}`);
  }
  const data = (await res.json()) as any;

  let entries: { version: string }[] = [];
  if (Array.isArray(data)) {
    entries = data;
  } else if (data && typeof data === "object") {
    for (const val of Object.values(data)) {
      if (Array.isArray(val)) {
        entries.push(...val);
      }
    }
  }

  if (entries.length === 0) {
    throw new Error("No build entries found");
  }

  const compareVersions = (a: string, b: string) => {
    const aParts = a.split(".").map((s) => parseInt(s, 10) || 0);
    const bParts = b.split(".").map((s) => parseInt(s, 10) || 0);
    const maxLen = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < maxLen; i++) {
      const aVal = aParts[i] ?? 0;
      const bVal = bParts[i] ?? 0;
      if (aVal !== bVal) {
        return aVal - bVal;
      }
    }
    return 0;
  };

  let highestEntry = entries[0];
  for (let i = 1; i < entries.length; i++) {
    if (compareVersions(entries[i].version, highestEntry.version) > 0) {
      highestEntry = entries[i];
    }
  }

  // build 号形状校验:该值会拼进缓存文件名与 URL,防 API 被劫持时的
  // 路径投毒(终审 F6)
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(highestEntry.version)) {
    throw new Error(`Unexpected build version format: ${highestEntry.version}`);
  }
  return highestEntry.version;
}

export async function fetchTable(
  table: string,
  build: string,
  cacheDir?: string,
): Promise<string> {
  let cacheFile: string | undefined;
  if (cacheDir) {
    cacheFile = path.join(cacheDir, `${table}-${build}.csv`);
    if (fs.existsSync(cacheFile)) {
      return fs.readFileSync(cacheFile, "utf8");
    }
  }

  const url = `https://wago.tools/db2/${table}/csv?build=${encodeURIComponent(
    build,
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch table ${table} for build ${build}: status ${res.status}`,
    );
  }

  const text = await res.text();

  if (cacheDir && cacheFile) {
    fs.ensureDirSync(cacheDir);
    fs.writeFileSync(cacheFile, text, "utf8");
  }

  return text;
}

export function assertColumns(
  header: string[],
  required: string[],
  table: string,
): void {
  const missing = required.filter((col) => !header.includes(col));
  if (missing.length > 0) {
    throw new Error(`Table ${table} is missing columns: ${missing.join(", ")}`);
  }
}

export function assertMinRows(
  rows: unknown[],
  min: number,
  what: string,
): void {
  if (rows.length < min) {
    throw new Error(
      `Expected at least ${min} rows for ${what}, but got ${rows.length}`,
    );
  }
}
