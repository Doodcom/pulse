import { contextBridge, ipcRenderer } from "electron";
import type { Vitals } from "./sensors";

contextBridge.exposeInMainWorld("pulse", {
  onVitals: (cb: (v: Vitals) => void) => {
    ipcRenderer.on("vitals", (_event, vitals: Vitals) => cb(vitals));
  },
  onPaused: (cb: (paused: boolean) => void) => {
    ipcRenderer.on("paused", (_event, paused: boolean) => cb(paused));
  },
  quit: () => ipcRenderer.send("quit"),
});
