/// <reference lib="webworker" />
// The off-thread derive worker (offThreadDerive.ts spawns it). All the logic
// lives in deriveWorkerCore.ts; this file is only the message plumbing.
import {
  createDeriveWorkerCore,
  type DeriveWorkerRequest,
} from "./deriveWorkerCore";

const core = createDeriveWorkerCore();
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (e: MessageEvent<DeriveWorkerRequest>) => {
  void core.handle(e.data).then((reply) => {
    if (reply) scope.postMessage(reply);
  });
};
