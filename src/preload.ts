import { contextBridge, ipcRenderer } from "electron";
import type { Vitals } from "./sensors";

contextBridge.exposeInMainWorld("pulse", {
  onVitals: (cb: (v: Vitals) => void) => {
    ipcRenderer.on("vitals", (_event, vitals: Vitals) => cb(vitals));
  },
  quit: () => ipcRenderer.send("quit"),
});
