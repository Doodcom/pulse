import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "node:path";
import { readVitals } from "./sensors";

const POLL_MS = 2000;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 240,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "..", "index.html"));
  return win;
}

app.whenReady().then(() => {
  const win = createWindow();

  const poll = async () => {
    try {
      const vitals = await readVitals();
      if (!win.isDestroyed()) win.webContents.send("vitals", vitals);
    } catch (err) {
      console.error("sensor poll failed:", err);
    }
  };
  poll();
  const timer = setInterval(poll, POLL_MS);
  win.on("closed", () => clearInterval(timer));

  ipcMain.on("quit", () => app.quit());
});

app.on("window-all-closed", () => app.quit());
