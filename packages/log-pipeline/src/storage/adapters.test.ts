import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describeStorageAdapterContract } from "./adapterContract";
import { LocalDirStorageAdapter } from "./LocalDirStorageAdapter";
import { MemoryStorageAdapter } from "./MemoryStorageAdapter";

describeStorageAdapterContract(
  "MemoryStorageAdapter",
  async () => new MemoryStorageAdapter(),
);

describeStorageAdapterContract(
  "LocalDirStorageAdapter",
  async () =>
    new LocalDirStorageAdapter(mkdtempSync(join(tmpdir(), "lp-adapter-"))),
);
