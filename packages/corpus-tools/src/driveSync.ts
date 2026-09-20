/** The pure-logic part of archiving fetch-pvp-logs to Google Drive (rclone).
 * The spawn shell lives in scripts/syncPvpLogsToDrive.ts; only unit-testable
 * argument building and output parsing live here. Design:
 * docs/plans/2026-07-30-pvp-logs-drive-sync-plan.md. */

export interface DriveSyncConfig {
  src: string;
  remote: string;
  dest: string;
  dryRun: boolean;
  /** Live progress meter. Off for unattended runs: without a TTY rclone prints
   * a full stats block every second, which floods the launchd log. */
  progress?: boolean;
}

/** A bare copy (size+modtime incremental) rather than --ignore-existing: logs
 * are immutable and so are skipped naturally, while manifest.json grows on
 * every fetch and must be re-uploaded. */
export function buildRcloneCopyArgs(cfg: DriveSyncConfig): string[] {
  return [
    "copy",
    cfg.src,
    `${cfg.remote}:${cfg.dest}`,
    ...(cfg.progress === false ? [] : ["--progress"]),
    "--transfers",
    "4",
    "--checkers",
    "8",
    "--exclude",
    ".DS_Store",
    ...(cfg.dryRun ? ["--dry-run"] : []),
  ];
}

/** `rclone listremotes` output -> list of remote names (trailing colon
 * stripped). */
export function parseListRemotes(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(":"))
    .map((l) => l.slice(0, -1));
}
