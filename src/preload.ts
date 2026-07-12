import { contextBridge, ipcRenderer } from "electron";
import type { Vitals } from "./sensors";

contextBridge.exposeInMainWorld("pulse", {
  onVitals: (cb: (v: Vitals) => void) => {
    ipcRenderer.on("vitals", (_event, vitals: Vitals) => cb(vitals));
  },
  onPaused: (cb: (paused: boolean) => void) => {
    ipcRenderer.on("paused", (_event, paused: boolean) => cb(paused));
  },
  loadState: () => ipcRenderer.invoke("state:load"),
  saveState: (state: unknown) => ipcRenderer.send("state:save", state),
  quit: () => ipcRenderer.send("quit"),
});
