import { promises as fs } from "node:fs";
import * as path from "node:path";

const HWMON_ROOT = "/sys/class/hwmon";

export interface TempReading {
  chip: string;
  label: string;
  celsius: number;
}

export interface FanReading {
  chip: string;
  label: string;
  rpm: number;
}

export interface Vitals {
  temps: TempReading[];
  fans: FanReading[];
  /** Total reported power draw in watts (GPU + CPU packages that expose it), or null if nothing reports it. */
  powerWatts: number | null;
  /** CPU utilisation 0..1 since the previous poll. */
  cpuLoad: number;
  /**
   * Hottest CPU/GPU temperature — drives the creature's mood. Other chips
   * (NVMe controllers, WiFi) idle hot by design and would skew it.
   */
  hottest: number;
}

async function readNum(file: string): Promise<number | null> {
  try {
    return parseInt(await fs.readFile(file, "utf8"), 10);
  } catch {
    return null;
  }
}

async function readStr(file: string): Promise<string | null> {
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch {
    return null;
  }
}

async function readChip(dir: string): Promise<{ temps: TempReading[]; fans: FanReading[]; watts: number }> {
  const chip = (await readStr(path.join(dir, "name"))) ?? path.basename(dir);
  const files = await fs.readdir(dir);
  const temps: TempReading[] = [];
  const fans: FanReading[] = [];
  let watts = 0;

  for (const f of files) {
    const tempMatch = f.match(/^temp(\d+)_input$/);
    if (tempMatch) {
      const raw = await readNum(path.join(dir, f));
      if (raw !== null && raw > 0) {
        const label = (await readStr(path.join(dir, `temp${tempMatch[1]}_label`))) ?? `temp${tempMatch[1]}`;
        temps.push({ chip, label, celsius: raw / 1000 });
      }
      continue;
    }
    const fanMatch = f.match(/^fan(\d+)_input$/);
    if (fanMatch) {
      const raw = await readNum(path.join(dir, f));
      if (raw !== null && raw > 0) {
        const label = (await readStr(path.join(dir, `fan${fanMatch[1]}_label`))) ?? `fan${fanMatch[1]}`;
        fans.push({ chip, label, rpm: raw });
      }
      continue;
    }
    if (/^power\d+_input$/.test(f)) {
      const raw = await readNum(path.join(dir, f));
      if (raw !== null) watts += raw / 1_000_000; // microwatts
    }
  }
  return { temps, fans, watts };
}

// /proc/stat snapshot for CPU load deltas between polls.
let prevIdle = 0;
let prevTotal = 0;

async function readCpuLoad(): Promise<number> {
  const stat = await fs.readFile("/proc/stat", "utf8");
  const fields = stat.split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  const idle = fields[3] + (fields[4] ?? 0); // idle + iowait
  const total = fields.reduce((a, b) => a + b, 0);
  const dIdle = idle - prevIdle;
  const dTotal = total - prevTotal;
  prevIdle = idle;
  prevTotal = total;
  if (dTotal <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - dIdle / dTotal));
}

export async function readVitals(): Promise<Vitals> {
  let dirs: string[] = [];
  try {
    dirs = (await fs.readdir(HWMON_ROOT)).map((d) => path.join(HWMON_ROOT, d));
  } catch {
    // No hwmon (container, exotic kernel) — degrade to load-only.
  }

  const chips = await Promise.all(dirs.map(readChip));
  const temps = chips.flatMap((c) => c.temps);
  const fans = chips.flatMap((c) => c.fans);
  const watts = chips.reduce((a, c) => a + c.watts, 0);
  const cpuLoad = await readCpuLoad();

  const MOOD_CHIPS = ["k10temp", "coretemp", "zenpower", "amdgpu", "nvidia"];
  const moodTemps = temps.filter((t) => MOOD_CHIPS.includes(t.chip));
  const moodSource = moodTemps.length > 0 ? moodTemps : temps;

  return {
    temps,
    fans,
    powerWatts: watts > 0 ? watts : null,
    cpuLoad,
    hottest: moodSource.reduce((m, t) => Math.max(m, t.celsius), 0),
  };
}
