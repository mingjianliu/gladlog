import { utilityProcess, type UtilityProcess } from "electron";
import type {
  MainToWorker,
  WorkerConfig,
  WorkerToMain,
} from "../shared/protocol";
import { nextCrashRecord, type CrashRecord } from "./crashPolicy";

export class WorkerHost {
  private child: UtilityProcess | null = null;
  private config: WorkerConfig | null = null;
  private crash: CrashRecord | null = null;
  private lastCurrent: { fileKey: string; offset: number } | null = null;
  private stopping = false;

  constructor(
    private opts: {
      workerModulePath: string;
      onMessage: (msg: WorkerToMain) => void;
      onQuarantine: (fileKey: string) => void;
      log: { info(m: string): void; error(m: string): void };
    },
  ) {}

  start(config: WorkerConfig): void {
    this.config = config;
    this.spawn();
  }

  reconfigure(config: WorkerConfig): void {
    this.config = config;
    this.send({ type: "configure", config });
  }

  stop(): void {
    this.stopping = true;
    this.child?.kill();
    this.child = null;
  }

  private send(msg: MainToWorker): void {
    this.child?.postMessage(msg);
  }

  private spawn(): void {
    if (!this.config) return;
    const child = utilityProcess.fork(this.opts.workerModulePath, [], {
      stdio: "pipe",
    });
    this.child = child;
    child.stdout?.on("data", (d: Buffer) =>
      this.opts.log.info(`[worker] ${d.toString().trim()}`),
    );
    child.stderr?.on("data", (d: Buffer) =>
      this.opts.log.error(`[worker] ${d.toString().trim()}`),
    );
    child.on("message", (msg: WorkerToMain) => {
      if (msg.type === "status" && msg.current) this.lastCurrent = msg.current;
      if (msg.type === "match" || msg.type === "shuffle") this.crash = null; // 有进展,清计数
      this.opts.onMessage(msg);
    });
    child.on("exit", (code) => {
      if (this.stopping) return;
      this.opts.log.error(`worker exited code=${code}, restarting in 1s`);
      const { record, quarantine } = nextCrashRecord(
        this.crash,
        this.lastCurrent,
      );
      this.crash = record;
      if (
        quarantine &&
        this.config &&
        !this.config.quarantined.includes(quarantine)
      ) {
        this.config = {
          ...this.config,
          quarantined: [...this.config.quarantined, quarantine],
        };
        this.opts.onQuarantine(quarantine);
      }
      setTimeout(() => this.spawn(), 1000);
    });
    child.once("spawn", () => {
      if (this.config) this.send({ type: "configure", config: this.config });
    });
  }
}
