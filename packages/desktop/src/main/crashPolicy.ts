export interface CrashRecord {
  fileKey: string | null;
  offset: number | null;
  count: number;
}
export const OFFSET_TOLERANCE = 65536;
const LIMIT = 3;

export function nextCrashRecord(
  prev: CrashRecord | null,
  current: { fileKey: string; offset: number } | null,
): { record: CrashRecord; quarantine: string | null } {
  if (!current)
    return {
      record: { fileKey: null, offset: null, count: 1 },
      quarantine: null,
    };
  const sameSpot =
    prev !== null &&
    prev.fileKey === current.fileKey &&
    prev.offset !== null &&
    Math.abs(current.offset - prev.offset) <= OFFSET_TOLERANCE;
  const count = sameSpot ? prev.count + 1 : 1;
  return {
    record: { fileKey: current.fileKey, offset: current.offset, count },
    quarantine: count >= LIMIT ? current.fileKey : null,
  };
}
