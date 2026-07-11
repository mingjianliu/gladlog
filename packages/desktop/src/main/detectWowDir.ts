import { existsSync } from "fs";
import { join } from "path";

export interface FsProbe {
  exists(p: string): boolean;
}
export function realFsProbe(): FsProbe {
  return { exists: (p) => existsSync(p) };
}

export function detectWowDirCandidates(opts: {
  platform: NodeJS.Platform;
  probe: FsProbe;
}): string[] {
  if (opts.platform !== "win32") return [];
  return [
    "C:\\Program Files (x86)\\World of Warcraft\\_retail_",
    "C:\\Program Files\\World of Warcraft\\_retail_",
  ].filter(
    (dir) => opts.probe.exists(dir) && opts.probe.exists(`${dir}\\Logs`),
  );
}

export function resolveLogsDir(
  selectedDir: string,
  probe: FsProbe = realFsProbe(),
): string {
  const logs = join(selectedDir, "Logs");
  return probe.exists(logs) ? logs : selectedDir;
}
