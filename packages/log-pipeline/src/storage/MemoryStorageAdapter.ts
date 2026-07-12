import { StorageAdapter } from "./StorageAdapter";

export class MemoryStorageAdapter implements StorageAdapter {
  private objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(body));
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  async get(key: string): Promise<Buffer> {
    const body = this.objects.get(key);
    if (!body) throw new Error(`MemoryStorageAdapter: no such key ${key}`);
    return Buffer.from(body);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  /** Test helper. */
  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}
