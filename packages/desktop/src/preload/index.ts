import { contextBridge } from "electron";
contextBridge.exposeInMainWorld("gladlog", { ping: () => "pong" });
