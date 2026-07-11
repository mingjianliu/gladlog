import type { MainToWorker, WorkerToMain } from "../shared/protocol";
import { createWorkerRuntime } from "./runtime";

const port = process.parentPort;
if (port) {
  createWorkerRuntime({
    transport: {
      post: (msg: WorkerToMain) => port.postMessage(msg),
      onMessage: (cb) =>
        port.on("message", (e: { data: MainToWorker }) => cb(e.data)),
    },
  });
}
