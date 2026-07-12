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
  /** RAM in use 0..1 (1 - MemAvailable/MemTotal). */
  memUsed: number;
  /** Network throughput (rx+tx, all interfaces except lo) in KB/s since the previous poll. */
  netKBps: number;
  /** Disk throughput (read+write, whole devices only) in KB/s since the previous poll. */
  diskKBps: number;
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

async function readMemUsed(): Promise<number> {
  try {
    const data = await fs.readFile("/proc/meminfo", "utf8");
    const total = Number(/MemTotal:\s+(\d+)/.exec(data)?.[1]);
    const avail = Number(/MemAvailable:\s+(\d+)/.exec(data)?.[1]);
    if (!total || !avail) return 0;
    return Math.min(1, Math.max(0, 1 - avail / total));
  } catch {
    return 0;
  }
}

let prevNetBytes = 0;
let prevNetTime = 0;

async function readNetKBps(): Promise<number> {
  let total = 0;
  try {
    const data = await fs.readFile("/proc/net/dev", "utf8");
    for (const line of data.split("\n").slice(2)) {
      const f = line.trim().split(/[:\s]+/);
      if (f.length < 10 || !f[0] || f[0] === "lo") continue;
      total += Number(f[1]) + Number(f[9]); // rx_bytes + tx_bytes
    }
  } catch {
    return 0;
  }
  const now = Date.now();
  const dt = (now - prevNetTime) / 1000;
  const rate = prevNetTime && dt > 0 ? (total - prevNetBytes) / 1024 / dt : 0;
  prevNetBytes = total;
  prevNetTime = now;
  return Math.max(0, rate);
}

const WHOLE_DISK = /^(sd[a-z]+|vd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/;
let prevDiskBytes = 0;
let prevDiskTime = 0;

async function readDiskKBps(): Promise<number> {
  let total = 0;
  try {
    const data = await fs.readFile("/proc/diskstats", "utf8");
    for (const line of data.split("\n")) {
      const f = line.trim().split(/\s+/);
      if (f.length < 11 || !WHOLE_DISK.test(f[2])) continue;
      total += (Number(f[5]) + Number(f[9])) * 512; // sectors read + written
    }
  } catch {
    return 0;
  }
  const now = Date.now();
  const dt = (now - prevDiskTime) / 1000;
  const rate = prevDiskTime && dt > 0 ? (total - prevDiskBytes) / 1024 / dt : 0;
  prevDiskBytes = total;
  prevDiskTime = now;
  return Math.max(0, rate);
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
  const [cpuLoad, memUsed, netKBps, diskKBps] = await Promise.all([
    readCpuLoad(),
    readMemUsed(),
    readNetKBps(),
    readDiskKBps(),
  ]);

  const MOOD_CHIPS = ["k10temp", "coretemp", "zenpower", "amdgpu", "nvidia"];
  const moodTemps = temps.filter((t) => MOOD_CHIPS.includes(t.chip));
  const moodSource = moodTemps.length > 0 ? moodTemps : temps;

  return {
    temps,
    fans,
    powerWatts: watts > 0 ? watts : null,
    cpuLoad,
    memUsed,
    netKBps,
    diskKBps,
    hottest: moodSource.reduce((m, t) => Math.max(m, t.celsius), 0),
  };
}
