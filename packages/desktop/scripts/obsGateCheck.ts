/**
 * OBS phase-2 gate check -- run this ON WINDOWS, with WoW running.
 *
 *   npm run recorder:gatecheck --workspace=packages/desktop
 *
 * Answers, in one shot, everything design doc 3 says must be confirmed on real
 * hardware before the managed-OBS work starts. THROWAWAY probe: hardcodes,
 * writes to a temp directory, touches no app code -- EXCEPT that the spawn/
 * readiness/config-generation steps below are no longer hand-rolled: they go
 * through the same `spawnManagedObs` / `writeObsConfig` / `clearSentinels`
 * the product path uses (task 3 -- single source, shared-predicate rule),
 * so this script now also doubles as that module's first real-hardware
 * exercise.
 *
 * Every obs-websocket call after connect is wrapped in a timeout (obs-websocket-js's
 * own call() never rejects on its own -- it awaits a response event with no reject
 * path, so an unresponsive OBS otherwise hangs this script forever) and failures are
 * caught per-call so one dead request degrades a single row instead of aborting the
 * whole run. `handle` (the managed obs64.exe) is cleaned up on every exit path: normal
 * completion, any thrown error, and Ctrl-C (the last one via killSync -- a SIGINT
 * handler cannot await handle.stop()'s graceful path).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import OBSWebSocket from "obs-websocket-js";

import {
  type ManagedObsHandle,
  spawnManagedObs,
} from "../src/main/managedObsProcess";
import { clearSentinels, writeObsConfig } from "../src/main/obsConfigWriter";
import {
  MANAGED_WS_PORT as WS_PORT,
  OBS_VERSION,
  OBS_ZIP_BYTES as OBS_BYTES,
  OBS_ZIP_SHA256 as OBS_SHA256,
  OBS_ZIP_URL as OBS_URL,
} from "../src/shared/obsAsset";

const WS_PASSWORD = "gladlog-gatecheck";
const OVERLAYS = [
  "RTSS",
  "RTSSHooksLoader64",
  "MSIAfterburner",
  "NVIDIA Share",
  "GeForceExperience",
];

// Every one of these bounds a network call, a PowerShell child process, or an
// obs-websocket RPC that has no built-in timeout of its own (see file header).
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const PS_TIMEOUT_MS = 8_000;
const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 10_000;
const CREATE_INPUT_TIMEOUT_MS = 20_000; // slow first-hook-attach path
const STOP_RECORD_TIMEOUT_MS = 15_000; // flush/mux right after a split can be slow
const DISCONNECT_TIMEOUT_MS = 5_000;

const row = (k: string, v: string) => console.log(`${k.padEnd(12)} ${v}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PsResult {
  ok: boolean;
  out: string;
}

/** Runs a PowerShell one-liner. Failure (missing binary, execution-policy block,
 * timeout) is reported as `ok: false`, never silently collapsed into an empty
 * string that a caller might mistake for "checked, found nothing". */
function ps(cmd: string): PsResult {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", cmd], {
    encoding: "utf-8",
    timeout: PS_TIMEOUT_MS,
  });
  const ok = !r.error && r.status === 0 && r.signal === null;
  return { ok, out: ok ? (r.stdout ?? "") : "" };
}

/** Clears its own timer on either settlement path (review cheap-cleanup,
 * 2026-08-03): `Promise.race` alone leaves the losing timer running until it
 * fires on its own, so every already-resolved call still holds the Node event
 * loop open for its full `ms` -- on a run whose last few calls use the 15-20s
 * timeouts (STOP_RECORD_TIMEOUT_MS et al.), the script visibly hangs that long
 * after printing its last row before the process actually exits. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} 超时 ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

type CallOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Every obs.call() after connect goes through here: bounded by withTimeout and
 * never rethrows, so a single stuck RPC degrades one row instead of hanging the
 * whole probe or killing runs that could still produce useful rows. */
async function guardedCall<T>(
  label: string,
  p: Promise<T>,
  ms: number,
): Promise<CallOutcome<T>> {
  try {
    return { ok: true, value: await withTimeout(p, ms, label) };
  } catch (error) {
    return { ok: false, error };
  }
}

function dirSizeMb(dir: string): number {
  let bytes = 0;
  const walk = (d: string) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, n.name);
      if (n.isDirectory()) walk(p);
      else bytes += statSync(p).size;
    }
  };
  walk(dir);
  return Math.round(bytes / 1_000_000);
}

// Hoisted so both the SIGINT handler and the top-level main().catch() can reach the
// managed OBS process from outside main()'s own try/finally -- the finally covers
// normal completion and any thrown error; these two cover the remaining paths
// (a hard Ctrl-C, or a failure between spawnManagedObs() and the try block).
let handle: ManagedObsHandle | undefined;

process.on("SIGINT", () => {
  console.error("\n收到 Ctrl-C,清理 OBS 子进程后退出…");
  // SYNC kill (复核 I5): a SIGINT handler cannot await handle.stop()'s
  // graceful 3s-then-taskkill path.
  handle?.killSync();
  process.exit(130);
});

async function safeDisconnect(obs: OBSWebSocket): Promise<void> {
  try {
    await withTimeout(
      obs.disconnect(),
      DISCONNECT_TIMEOUT_MS,
      "obs.disconnect",
    );
  } catch {
    // best effort -- we're tearing down anyway
  }
}

/** Try IPv4 loopback first, then IPv6. With --disable-shutdown-check in place
 * OBS binds DUAL-STACK (0.0.0.0 + [::]) and 127.0.0.1 connects on the first
 * try (真机 2026-08-05); the ::1 fallback is kept as cheap insurance for any
 * machine whose asio build ever binds only one family. NOTE: the 2026-08-04
 * "asio only binds IPv6" reading was a misdiagnosis of the unclean-shutdown
 * safe-mode prompt — see managedObsProcess.ts's header. */
async function connectEither(
  obs: OBSWebSocket,
): Promise<{ obsWebSocketVersion?: string }> {
  const addrs = [`ws://127.0.0.1:${WS_PORT}`, `ws://[::1]:${WS_PORT}`];
  let last: unknown;
  for (const a of addrs) {
    try {
      return await obs.connect(a, WS_PASSWORD);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    console.error("这个脚本只能在 Windows 上跑 —— 它要验的就是 Windows 行为。");
    process.exit(2);
  }

  const root = join(tmpdir(), "gladlog-obs-gate");
  mkdirSync(root, { recursive: true });
  const zipPath = join(root, "obs.zip");
  const obsRoot = join(root, OBS_VERSION);
  const recDir = join(root, "rec");
  // Cleared every run: recDir is ephemeral recording output (unlike obsRoot/zipPath,
  // which are cached across runs on purpose), and stale chunks from an earlier
  // partial run would silently inflate the bitrate row below.
  if (existsSync(recDir)) rmSync(recDir, { recursive: true, force: true });
  mkdirSync(recDir, { recursive: true });

  // --- download + verify ------------------------------------------------
  if (!existsSync(zipPath) || statSync(zipPath).size !== OBS_BYTES) {
    console.log(`下载 OBS ${OBS_VERSION}(179MB,只下一次)…`);
    const controller = new AbortController();
    const downloadTimer = setTimeout(
      () => controller.abort(),
      DOWNLOAD_TIMEOUT_MS,
    );
    try {
      const res = await fetch(OBS_URL, { signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`);
      let downloaded = 0;
      let lastLoggedTenMb = -1;
      const progress = new Transform({
        transform(chunk: Buffer, _enc, callback) {
          downloaded += chunk.length;
          const tenMb = Math.floor(downloaded / 10_000_000);
          if (tenMb !== lastLoggedTenMb) {
            lastLoggedTenMb = tenMb;
            process.stdout.write(
              `\r  下载中… ${(downloaded / 1_000_000).toFixed(0)}MB / ${(
                OBS_BYTES / 1_000_000
              ).toFixed(0)}MB`,
            );
          }
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(res.body as never),
        progress,
        createWriteStream(zipPath),
      );
      process.stdout.write("\n");
    } finally {
      clearTimeout(downloadTimer);
    }
  }
  const got = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
  row(
    "download",
    got === OBS_SHA256 ? `OK (${OBS_BYTES}B)` : `哈希不符 ${got}`,
  );
  if (got !== OBS_SHA256) {
    // Delete the corrupt-but-right-size file (review cheap-cleanup,
    // 2026-08-03): the cache check above is `size !== OBS_BYTES`, so a file
    // that is the right SIZE but wrong CONTENT (partial write that happened to
    // land on the right byte count, bit flip, etc.) would keep passing that
    // check and failing this hash check identically forever -- the human
    // would have to know to go clear %TEMP% by hand. Removing it here makes
    // the next run re-download instead of repeating the same failure.
    rmSync(zipPath, { force: true });
    process.exit(1);
  }

  // --- extract with the system tar (bsdtar) -- assumption under test -----
  const obsExe = join(obsRoot, "bin", "64bit", "obs64.exe");
  if (!existsSync(obsExe)) {
    mkdirSync(obsRoot, { recursive: true });
    const r = spawnSync("tar", ["-xf", zipPath, "-C", obsRoot], {
      encoding: "utf-8",
    });
    if (r.status !== 0) {
      row("extract", `tar -xf 失败:${(r.stderr ?? "").slice(0, 200)}`);
      process.exit(1);
    }
  }
  row(
    "extract",
    existsSync(obsExe)
      ? `OK (${dirSizeMb(obsRoot)}MB,全量未裁剪)`
      : "obs64.exe 不在预期路径",
  );

  // --- write config (single source: writeObsConfig -- 复核 M2; the gate
  // script no longer hand-rolls its own ini/json, so a drift between what it
  // verifies and what the product actually ships is structurally impossible) ---
  writeObsConfig({
    obsRoot,
    recDir,
    wsPort: WS_PORT,
    wsPassword: WS_PASSWORD,
    bitrateKbps: 8000,
  });

  // --- environment checks (design doc 3's top three risks) --------------
  const gpuProbe = ps("Get-CimInstance Win32_VideoController | % { $_.Name }");
  const gpuList = gpuProbe.ok
    ? gpuProbe.out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const gpuPrefProbe = ps(
    "try { (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences').PSObject.Properties | " +
      "? { $_.Name -like '*Wow*' } | % { \"$($_.Name)=$($_.Value)\" } } catch { '' }",
  );
  row(
    "gpu",
    !gpuProbe.ok
      ? "无法判定(PowerShell 查询失败,不能断言单卡/多卡)"
      : `显卡 ${gpuList.length} 块:${gpuList.join(" / ")}` +
          (gpuList.length > 1
            ? ` —— 多卡机器,WoW 的 GPU 偏好:${
                gpuPrefProbe.ok
                  ? gpuPrefProbe.out.trim() || "(未设置)"
                  : "无法判定"
              };起录后请对照 OBS 日志里 'Loading up D3D11 on adapter' 那行是否同一块`
            : "(单卡,无适配器不匹配风险)"),
  );

  // Two independent try/catch layers, on purpose: a failure probing MainModule
  // access (the elevation-mismatch signal) must never be reported as "WoW absent" --
  // that conflation would hide exactly the condition this row exists to catch.
  const wowProbe = ps(
    "try { $p = Get-Process Wow -ErrorAction Stop; " +
      "try { $null = $p.MainModule; 'RUNNING|ACCESSIBLE' } " +
      "catch { 'RUNNING|ACCESS_DENIED' } } catch { 'ABSENT' }",
  );
  const wowState = !wowProbe.ok
    ? "无法判定(PowerShell 查询失败)"
    : wowProbe.out.trim() === "ABSENT"
      ? "未运行"
      : wowProbe.out.trim() === "RUNNING|ACCESS_DENIED"
        ? "运行中但句柄不可访问(强烈暗示与本脚本提权不对等)"
        : wowProbe.out.trim() === "RUNNING|ACCESSIBLE"
          ? "运行中且句柄可访问(提权对等)"
          : `无法判定(未知输出:${wowProbe.out.trim()})`;
  const selfAdminProbe = ps(
    "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent())" +
      ".IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
  );
  const selfAdmin = selfAdminProbe.ok ? selfAdminProbe.out.trim() : "无法判定";
  row(
    "integrity",
    `WoW 进程:${wowState};本脚本管理员权限=${selfAdmin} —— ` +
      "若 WoW 提权而这里不是,钩取会失败(设计文档 §3 第 2 号成因)",
  );

  const runningProbe = ps("Get-Process | % { $_.ProcessName }");
  const hits = runningProbe.ok
    ? OVERLAYS.filter((o) =>
        runningProbe.out
          .split(/\r?\n/)
          .some((p) => p.trim().toLowerCase() === o.toLowerCase()),
      )
    : [];
  row(
    "hooks",
    !runningProbe.ok
      ? "无法判定(PowerShell 查询失败,不能断言无冲突覆盖层)"
      : hits.length
        ? `冲突覆盖层在场:${hits.join(", ")}`
        : "无已知冲突覆盖层",
  );

  // --- spawn (managedObsProcess -- task 3; 复核 I6 单变量纪律: this first
  // real-machine run keeps the original --websocket_port/--websocket_password
  // flags via extraArgs -- switching their source to config.json is the
  // NEXT run's variable, not this one) --------------------------------
  clearSentinels(obsRoot);
  handle = spawnManagedObs({
    obsRoot,
    wsPort: WS_PORT,
    extraArgs: [
      "--websocket_port",
      String(WS_PORT),
      "--websocket_password",
      WS_PASSWORD,
    ],
  });

  const obs = new OBSWebSocket();
  // MUST be attached before StartRecord: SplitRecordFile returns no filename,
  // and StopRecord.outputPath keeps returning the FIRST chunk (design doc 2.5).
  const chunks: Array<{ path: string; at: number }> = [];
  obs.on("RecordFileChanged", (d: { newOutputPath: string }) =>
    chunks.push({ path: d.newOutputPath, at: Date.now() }),
  );
  obs.on(
    "RecordStateChanged",
    (d: { outputState: string; outputPath?: string }) => {
      if (d.outputState.endsWith("STARTED") && d.outputPath) {
        chunks.push({ path: d.outputPath, at: Date.now() });
      }
    },
  );

  // From here on, every exit path -- normal return, a thrown error, or the
  // process-level SIGINT handler above -- kills `handle` and drops the websocket.
  try {
    // Readiness = OBS's own log (managedObsProcess), never a bare TCP probe --
    // this is the answer to the 2026-08-04 mystery (gate script's spawn never
    // produced a log file under the old ad-hoc spawn): if that repeats, this
    // row now says "OBS 未产出日志" instead of an undiagnosable ECONNREFUSED.
    try {
      const { wsUrl } = await handle.ready;
      row(
        "spawn",
        `OK(OBS 日志确认就绪:portable + websocket started, ${wsUrl})`,
      );
    } catch (e) {
      const exit = handle.exited();
      const childStatus = exit
        ? `OBS 进程已退出(code=${exit.code ?? "null"}, signal=${exit.signal ?? "null"})`
        : "OBS 进程仍在跑 —— 去看一眼屏幕上有没有弹窗";
      row("spawn", `未就绪:${String(e)} —— ${childStatus}`);
      // Nothing past this point can succeed without a running, ready OBS;
      // abort the remaining OBS-dependent rows, but let the outer finally
      // still clean up.
      throw new Error("OBS 未就绪,后续步骤已放弃");
    }

    try {
      const hello = await withTimeout(
        connectEither(obs),
        CONNECT_TIMEOUT_MS,
        "websocket 连接",
      );
      row("websocket", `OK obs-websocket ${hello.obsWebSocketVersion ?? "?"}`);
    } catch (e) {
      const exit = handle.exited();
      const childStatus = exit
        ? `OBS 进程已退出(code=${exit.code ?? "null"}, signal=${exit.signal ?? "null"})`
        : "OBS 进程仍在跑 —— 去看一眼屏幕上有没有弹窗";
      row("websocket", `连不上:${String(e)} —— ${childStatus}`);
      throw new Error("websocket 连接失败,后续步骤已放弃");
    }

    const profileOutcome = await guardedCall(
      "GetProfileList",
      obs.call("GetProfileList"),
      CALL_TIMEOUT_MS,
    );
    row(
      "profile",
      !profileOutcome.ok
        ? `GetProfileList 失败/超时:${String(profileOutcome.error)}`
        : profileOutcome.value.currentProfileName === "gladlog"
          ? "OK 生效的是 gladlog(便携路径 cwd 假设成立)"
          : `生效的是 ${profileOutcome.value.currentProfileName} —— 静默回退了,cwd 假设不成立`,
    );

    const kindsOutcome = await guardedCall(
      "GetInputKindList",
      obs.call("GetInputKindList"),
      CALL_TIMEOUT_MS,
    );
    const inputKinds = kindsOutcome.ok ? kindsOutcome.value.inputKinds : [];
    row(
      "encoders",
      !kindsOutcome.ok
        ? `GetInputKindList 失败/超时:${String(kindsOutcome.error)}`
        : `输入类型 ${inputKinds.length} 种,game_capture ${
            inputKinds.includes("game_capture") ? "在" : "不在"
          }`,
    );

    const createOutcome = await guardedCall(
      "CreateInput",
      obs.call("CreateInput", {
        sceneName: "gladlog",
        inputName: "gc",
        inputKind: "game_capture",
        inputSettings: {
          capture_mode: "any_fullscreen",
          priority: 2,
          anti_cheat_hook: true,
        },
        sceneItemEnabled: true,
      }),
      CREATE_INPUT_TIMEOUT_MS,
    );
    if (!createOutcome.ok) {
      row("gc-input", `CreateInput 失败/超时:${String(createOutcome.error)}`);
    }
    await sleep(5000); // give the hook time to attach

    // ---- 2026-09-05 真机三症状的判据行 ----------------------------------
    // 症状 2「录像只有画面左上角一小块」和症状 1「完全没有声音」都是这一段
    // 之前从来没问过的事实。裸看 mp4 判断不了原因,这三行直接问 OBS 本人。
    const videoOutcome = await guardedCall(
      "GetVideoSettings",
      obs.call("GetVideoSettings"),
      CALL_TIMEOUT_MS,
    );
    const canvasW = videoOutcome.ok
      ? (videoOutcome.value.baseWidth as number)
      : 0;
    const canvasH = videoOutcome.ok
      ? (videoOutcome.value.baseHeight as number)
      : 0;
    const itemOutcome = await guardedCall(
      "GetSceneItemId",
      obs.call("GetSceneItemId", { sceneName: "gladlog", sourceName: "gc" }),
      CALL_TIMEOUT_MS,
    );
    if (itemOutcome.ok) {
      const sceneItemId = itemOutcome.value.sceneItemId as number;
      const xformOutcome = await guardedCall(
        "GetSceneItemTransform",
        obs.call("GetSceneItemTransform", {
          sceneName: "gladlog",
          sceneItemId,
        }),
        CALL_TIMEOUT_MS,
      );
      if (!xformOutcome.ok) {
        row(
          "fit",
          `GetSceneItemTransform 失败/超时:${String(xformOutcome.error)}`,
        );
      } else {
        const t = xformOutcome.value.sceneItemTransform as Record<
          string,
          unknown
        >;
        const srcW = Number(t.sourceWidth ?? 0);
        const srcH = Number(t.sourceHeight ?? 0);
        const outW = Number(t.width ?? 0);
        const outH = Number(t.height ?? 0);
        // 判据:源在画布上实际占的矩形,必须覆盖画布(等比缩放后至少一边贴边),
        // 而不是超出画布被裁。裁掉的面积比例是那句「只有左上角一小块」的数字化。
        const shownFrac =
          srcW > 0 && srcH > 0
            ? (Math.min(outW, canvasW) * Math.min(outH, canvasH)) /
              (outW * outH || 1)
            : 0;
        row(
          "fit",
          `画布 ${canvasW}x${canvasH};源 ${srcW}x${srcH};上画布后 ${outW}x${outH};` +
            `boundsType=${String(t.boundsType)};入镜面积 ${(shownFrac * 100).toFixed(1)}%` +
            (shownFrac > 0.999
              ? " OK"
              : " —— 被画布裁了,这就是「只有左上角一块」"),
        );
      }
    } else {
      row("fit", `GetSceneItemId 失败/超时:${String(itemOutcome.error)}`);
    }

    const specialOutcome = await guardedCall(
      "GetSpecialInputs",
      obs.call("GetSpecialInputs"),
      CALL_TIMEOUT_MS,
    );
    if (!specialOutcome.ok) {
      row(
        "audio-ch",
        `GetSpecialInputs 失败/超时:${String(specialOutcome.error)}`,
      );
    } else {
      const desktop1 = specialOutcome.value.desktop1;
      row(
        "audio-ch",
        typeof desktop1 === "string" && desktop1
          ? `OK 通道1 = ${desktop1}(场景集合的 DesktopAudioDevice1 装上了)`
          : "通道1 空 —— 场景集合里的桌面音频没被 OBS 装上,录出来必然没声音",
      );
      if (typeof desktop1 === "string" && desktop1) {
        const tracksOutcome = await guardedCall(
          "GetInputAudioTracks",
          obs.call("GetInputAudioTracks", { inputName: desktop1 }),
          CALL_TIMEOUT_MS,
        );
        const muteOutcome = await guardedCall(
          "GetInputMute",
          obs.call("GetInputMute", { inputName: desktop1 }),
          CALL_TIMEOUT_MS,
        );
        row(
          "audio-track",
          !tracksOutcome.ok
            ? `GetInputAudioTracks 失败/超时:${String(tracksOutcome.error)}`
            : `轨道 ${JSON.stringify(tracksOutcome.value.inputAudioTracks)};` +
                (muteOutcome.ok
                  ? `muted=${String(muteOutcome.value.inputMuted)}`
                  : "muted=?") +
                ' —— basic.ini 的 RecTracks=1 只录轨道1,这里 "1":true 才有声',
        );
      }
    }
    // --------------------------------------------------------------------

    const shotPath = join(root, "shot.png");
    const shotOutcome = await guardedCall(
      "SaveSourceScreenshot",
      obs.call("SaveSourceScreenshot", {
        sourceName: "gc",
        imageFormat: "png",
        imageFilePath: shotPath,
      }),
      CALL_TIMEOUT_MS,
    );
    row(
      "capture",
      !shotOutcome.ok
        ? `截图失败/超时:${String(shotOutcome.error)}`
        : existsSync(shotPath)
          ? `截图已存 ${shotPath} —— 打开看是不是黑的`
          : `RPC 报告成功,但文件不在磁盘上:${shotPath}`,
    );

    // --- record + split ---------------------------------------------------
    const recordStart = Date.now();
    const startOutcome = await guardedCall(
      "StartRecord",
      obs.call("StartRecord"),
      CALL_TIMEOUT_MS,
    );
    if (!startOutcome.ok) {
      row(
        "record-start",
        `StartRecord 失败/超时:${String(startOutcome.error)}`,
      );
    }
    await sleep(20_000);
    const splitOutcome = await guardedCall(
      "SplitRecordFile",
      obs.call("SplitRecordFile"),
      CALL_TIMEOUT_MS,
    );
    if (!splitOutcome.ok) {
      row(
        "record-split",
        `SplitRecordFile 失败/超时:${String(splitOutcome.error)}`,
      );
    }
    await sleep(3000);
    const stopOutcome = await guardedCall(
      "StopRecord",
      obs.call("StopRecord"),
      STOP_RECORD_TIMEOUT_MS,
    );
    if (!stopOutcome.ok) {
      row("record-stop", `StopRecord 失败/超时:${String(stopOutcome.error)}`);
    }
    await sleep(2000);
    const recordEnd = Date.now();

    row(
      "split",
      chunks.length
        ? `拿到 ${chunks.length} 个分片路径:${chunks.map((c) => c.path).join(" | ")}`
        : "没收到任何 RecordFileChanged / RecordStateChanged 路径",
    );

    const files = readdirSync(recDir).map(
      (f) => statSync(join(recDir, f)).size,
    );
    const total = files.reduce((n, x) => n + x, 0);
    const secs = (recordEnd - recordStart) / 1000;
    row(
      "bitrate",
      `${(total / 1_000_000).toFixed(1)}MB / ${secs.toFixed(0)}s → 约 ${(
        (total * 8) /
        secs /
        1e6
      ).toFixed(
        1,
      )} Mbps(用来定设计文档 §10 U2;recDir 每次跑清空,不会掺进上一轮的残留)`,
    );

    console.log("\n产物目录(截图与录像都在,自己看完再删):", root);
  } finally {
    await safeDisconnect(obs);
    await handle.stop();
  }
}

main().catch(async (e) => {
  console.error("门测失败:", e);
  await handle?.stop();
  process.exit(1);
});
