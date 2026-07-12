# Pulse

Your PC's vitals as a desktop creature. It reads `/sys/class/hwmon` and gets
progressively angrier as your rig heats up — and now it grows, talks, and
holds grudges.

## Moods

| Hottest CPU/GPU sensor | Mood |
| --- | --- |
| < 55 °C | chill (green, smiling) |
| 55–70 °C | warm (yellow, neutral) |
| 70–82 °C | hot (orange, frowning) |
| > 82 °C | critical (red, angry, shaking + desktop notification) |

## Senses

- **CPU load** — breathing speeds up under load
- **RAM pressure** — it gets visibly chubbier past 50% used
- **Network activity** — its ears twitch
- **Disk I/O** — its eyes dart around
- **Fans** — a dashed ring spins at fan speed (hidden if your board exposes no fan sensors)

## The game

Healthy temps earn XP (about 1800/hour); critical temps *drain* it. Click the
creature to pet it (+25 XP, max once a minute — it still appreciates the rest).
At XP thresholds it evolves: **Blobling → Sproutling → Hornling → Crowned →
Ascendant**, each with a visible upgrade. Cook your machine long enough and it
devolves, and it will be rude about it. State persists in Electron's userData
dir (`~/.config/pulse/state.json`).

It also comments on your behavior: sustained full-tilt load, sudden temp
spikes, 3am sessions, and total idleness all get remarks. It's not chatty —
everything's on cooldowns.

## Run

```fish
npm install
npm start
```

Drag the creature anywhere; hover and hit ✕ to quit. The tray icon has
Pause (puts the creature to sleep) and Quit.

To get it in the app launcher (paths in `pulse.desktop` are absolute —
adjust if the project lives elsewhere):

```fish
cp pulse.desktop ~/.local/share/applications/
```

## Package

- **AppImage**: `npm run dist` → `release/Pulse-<version>.AppImage`
- **Arch/AUR**: `packaging/PKGBUILD` builds `pulse-widget-git` against system
  electron (`makepkg -si` from that directory to test locally)

## Layout

- `src/sensors.ts` — hwmon scanner (temps, fans, power) + `/proc` readers (CPU load, RAM, net, disk)
- `src/main.ts` — frameless always-on-top window, 2 s sensor poll, notifications, state persistence
- `src/preload.ts` — exposes `window.pulse` (contextIsolation on)
- `src/renderer.ts` — mood logic, game loop, speech triggers, SVG face
- `index.html` — the creature, stats panel, XP bar

## Ideas for later

- Sounds when it goes critical (it should complain)
- Click-through mode (`setIgnoreMouseEvents`)
- Windows port (LibreHardwareMonitor) — prerequisite for Steam
