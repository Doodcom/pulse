import { app, BrowserWindow, ipcMain, Menu, Tray } from "electron";
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

let tray: Tray | null = null; // keep a reference so it isn't garbage-collected

app.whenReady().then(() => {
  const win = createWindow();
  let paused = false;

  const poll = async () => {
    if (paused) return;
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

  tray = new Tray(path.join(__dirname, "..", "assets", "tray.png"));
  tray.setToolTip("Pulse");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Pause",
        type: "checkbox",
        checked: false,
        click: (item) => {
          paused = item.checked;
          if (!win.isDestroyed()) win.webContents.send("paused", paused);
          if (!paused) poll();
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );

  ipcMain.on("quit", () => app.quit());
});

app.on("window-all-closed", () => app.quit());
