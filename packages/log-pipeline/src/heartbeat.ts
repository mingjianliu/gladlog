import { buildHeartbeatKey } from "./protocol/segments";
import { StorageAdapter } from "./storage/StorageAdapter";

export interface AgentHeartbeat {
  hostname: string;
  lastFlushAt: string;
  activeFile: string | null;
  offset: number | null;
  agentVersion: string;
  lastError: string | null;
}

export async function writeHeartbeat(
  adapter: StorageAdapter,
  hb: AgentHeartbeat,
): Promise<void> {
  await adapter.put(
    buildHeartbeatKey(hb.hostname),
    Buffer.from(JSON.stringify(hb, null, 2)),
  );
}
