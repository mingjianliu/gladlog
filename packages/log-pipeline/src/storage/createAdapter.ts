import { StorageConfig } from "../config";
import { LocalDirStorageAdapter } from "./LocalDirStorageAdapter";
import { StorageAdapter } from "./StorageAdapter";

export function createAdapter(storage: StorageConfig): StorageAdapter {
  switch (storage.provider) {
    case "localDir":
      return new LocalDirStorageAdapter(storage.directory);
  }
}
