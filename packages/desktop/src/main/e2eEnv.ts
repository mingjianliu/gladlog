import { isAbsolute, join } from "path";

/**
 * The userData directory in E2E mode. The switch does exactly one thing: move
 * the state directory to a temporary path so end-to-end tests run on clean,
 * disposable state.
 *
 * When enabled without a valid path it **throws instead of falling back** —
 * silently using the real userData would let tests pollute user data.
 */
export function e2eUserDataDir(env: NodeJS.ProcessEnv): string | null {
  if (env["GLADLOG_E2E"] !== "1") return null;
  const dir = env["GLADLOG_E2E_USER_DATA"];
  if (!dir || !isAbsolute(dir)) {
    throw new Error(
      "GLADLOG_E2E=1 需要 GLADLOG_E2E_USER_DATA 指向一个绝对路径",
    );
  }
  return dir;
}

/** Where an E2E run's `main.log` goes: inside its disposable userData. */
export function e2eLogFile(userDataDir: string): string {
  return join(userDataDir, "logs", "main.log");
}

/** The two things of Electron and electron-log the E2E switch moves. */
export interface E2eTargets {
  app: { setPath(name: "userData" | "logs", path: string): void };
  log: {
    transports: { file: { resolvePathFn: (...args: never[]) => string } };
  };
}

/**
 * Applies the E2E switch to the process: every place the app writes state
 * moves into the temporary directory. Returns that directory, or null when
 * the switch is off (nothing is touched).
 *
 * userData alone was not all of it (pipeline T198): electron-log writes
 * `main.log` to Electron's `logs` path, which on macOS is
 * `~/Library/Logs/<app>` whatever userData says — an E2E run on a
 * developer's Mac appended its lines to the real log, the file a user's
 * report is read from. The `logs` path moves with userData, and the file
 * transport is pointed at the same file directly, so the log does not depend
 * on which of the two electron-log reads.
 *
 * Must run before the first `app.getPath("userData")` and before
 * `log.initialize()`.
 */
export function applyE2eEnv(
  env: NodeJS.ProcessEnv,
  targets: E2eTargets,
): string | null {
  const dir = e2eUserDataDir(env);
  if (!dir) return null;
  const logFile = e2eLogFile(dir);
  targets.app.setPath("userData", dir);
  targets.app.setPath("logs", join(dir, "logs"));
  targets.log.transports.file.resolvePathFn = () => logFile;
  return dir;
}
