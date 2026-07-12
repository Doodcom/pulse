# Pulse

Your PC's vitals as a desktop creature. It reads `/sys/class/hwmon` and gets
progressively angrier as your rig heats up.

| Hottest sensor | Mood |
| --- | --- |
| < 55 °C | chill (green, smiling) |
| 55–70 °C | warm (yellow, neutral) |
| 70–82 °C | hot (orange, frowning) |
| > 82 °C | critical (red, angry, shaking) |

Breathing speed tracks CPU load. Blinks because it's alive. If your board
exposes fan sensors, a dashed ring spins around the creature at a speed
scaled to the fastest fan (no fan data — no ring).

## Run

```fish
npm install
npm start
```

Drag the creature anywhere; hover and hit ✕ to quit. The tray icon has
Pause (puts the creature to sleep) and Quit.

## Layout

- `src/sensors.ts` — hwmon scanner (temps, fans, power) + `/proc/stat` CPU load
- `src/main.ts` — frameless always-on-top window, polls sensors every 2 s
- `src/preload.ts` — exposes `window.pulse` (contextIsolation on)
- `src/renderer.ts` — mood logic, SVG face, blink/breathe animations
- `index.html` — the creature and stats panel

## Ideas for later

- Sounds when it goes critical (it should complain)
- Click-through mode (`setIgnoreMouseEvents`)
