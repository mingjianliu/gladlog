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

/** wago.tools' product key of the live retail client. The builds API returns
 * every product it tracks — the public test realm (`wowt`), the PTR
 * (`wowxptr`), beta, Classic — and ignores the `branch` / `product` query
 * parameters, so the highest version over the whole answer is a test-realm
 * build whenever one is up (2026-11-22: 12.1.7.71087 on `wowt` while live was
 * 12.1.5.70961). Maintainer ruling 2026-11-22: a build that is not live is not
 * used. */
export const LIVE_RETAIL_PRODUCT = "wow";

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

/**
 * The highest LIVE retail build in a wago.tools `/api/builds` answer: the
 * entries under the `wow` key of the by-product object, or the entries whose
 * own `product` is `wow` when the answer is a flat list. Entries of any other
 * product never count, and an answer with no live entry is an error — never
 * a fallback to "the highest of whatever came back".
 */
export function latestLiveBuild(data: unknown): string {
  let entries: { version?: unknown; product?: unknown }[] = [];
  if (Array.isArray(data)) {
    entries = data.filter(
      (e) => e && typeof e === "object" && e.product === LIVE_RETAIL_PRODUCT,
    );
  } else if (data && typeof data === "object") {
    const live = (data as Record<string, unknown>)[LIVE_RETAIL_PRODUCT];
    if (Array.isArray(live)) {
      entries = live.filter(
        (e) =>
          e &&
          typeof e === "object" &&
          (e.product === undefined || e.product === LIVE_RETAIL_PRODUCT),
      );
    }
  }

  // Shape check on the build number: this value is interpolated into cache file
  // names and URLs, so validating it guards against path poisoning if the API is
  // hijacked (final review F6)
  const versions = entries.map((e) => e.version);
  for (const v of versions) {
    if (typeof v !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(v)) {
      throw new Error(`Unexpected build version format: ${String(v)}`);
    }
  }
  if (versions.length === 0) {
    throw new Error(
      `No live retail build (product "${LIVE_RETAIL_PRODUCT}") in the build list`,
    );
  }
  return (versions as string[]).reduce((hi, v) =>
    compareVersions(v, hi) > 0 ? v : hi,
  );
}

export async function fetchLatestBuild(): Promise<string> {
  const url = "https://wago.tools/api/builds";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch build list: ${res.statusText}`);
  }
  return latestLiveBuild(await res.json());
}

/**
 * Build-number resolution for every datagen script (single source):
 * explicit CLI argument > DATAGEN_BUILD (the batch pin) > wago's latest LIVE
 * retail build (`latestLiveBuild`).
 * Scripts must not call fetchLatestBuild() for their own build — per-script
 * resolution is how genSpellIcons ran a whole batch on a stale manifest build
 * while every other artifact was on the new one (2026-08-11). Manifest-reading
 * scripts (genSpellIcons/genSpecIcons) keep the manifest as a fallback BELOW
 * DATAGEN_BUILD: the manifest is a heuristic, not an operator instruction.
 */
export async function resolveBuild(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  if (process.env.DATAGEN_BUILD) return process.env.DATAGEN_BUILD;
  return fetchLatestBuild();
}

export async function fetchTable(
  table: string,
  build: string,
  cacheDir?: string,
  locale?: string,
): Promise<string> {
  let cacheFile: string | undefined;
  const cacheKey = locale
    ? `${table}-${locale}-${build}.csv`
    : `${table}-${build}.csv`;
  if (cacheDir) {
    cacheFile = path.join(cacheDir, cacheKey);
    if (fs.existsSync(cacheFile)) {
      return fs.readFileSync(cacheFile, "utf8");
    }
  }

  const url =
    `https://wago.tools/db2/${table}/csv?build=${encodeURIComponent(build)}` +
    (locale ? `&locale=${encodeURIComponent(locale)}` : "");
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
