import { app, BrowserWindow, ipcMain, Menu, Notification, Tray } from "electron";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { readVitals } from "./sensors";

const POLL_MS = 2000;
const CRITICAL_C = 82;
const NOTIFY_COOLDOWN_MS = 5 * 60_000;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 250,
    height: 330,
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
  let lastNotify = 0;

  const poll = async () => {
    if (paused) return;
    try {
      const vitals = await readVitals();
      if (!win.isDestroyed()) win.webContents.send("vitals", vitals);
      if (
        vitals.hottest >= CRITICAL_C &&
        Date.now() - lastNotify > NOTIFY_COOLDOWN_MS &&
        Notification.isSupported()
      ) {
        lastNotify = Date.now();
        new Notification({
          title: "Pulse",
          body: `Running hot: ${Math.round(vitals.hottest)}°C — your creature is not happy.`,
        }).show();
      }
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

  const statePath = path.join(app.getPath("userData"), "state.json");
  ipcMain.handle("state:load", async () => {
    try {
      return JSON.parse(await fs.readFile(statePath, "utf8"));
    } catch {
      return null;
    }
  });
  ipcMain.on("state:save", (_event, state) => {
    fs.writeFile(statePath, JSON.stringify(state)).catch((err) =>
      console.error("state save failed:", err),
    );
  });

  ipcMain.on("quit", () => app.quit());
});

app.on("window-all-closed", () => app.quit());
