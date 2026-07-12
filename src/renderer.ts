// Renderer script. Deliberately no imports/exports so tsc emits a plain
// browser script (contextIsolation is on; everything arrives via window.pulse).

interface PulseTempReading { chip: string; label: string; celsius: number }
interface PulseFanReading { chip: string; label: string; rpm: number }
interface PulseVitals {
  temps: PulseTempReading[];
  fans: PulseFanReading[];
  powerWatts: number | null;
  cpuLoad: number;
  memUsed: number;
  netKBps: number;
  diskKBps: number;
  hottest: number;
}
interface PulseGameState { v: 1; xp: number; patCount: number; createdAt: number }
interface PulseApi {
  onVitals: (cb: (v: PulseVitals) => void) => void;
  onPaused: (cb: (paused: boolean) => void) => void;
  loadState: () => Promise<PulseGameState | null>;
  saveState: (s: PulseGameState) => void;
  quit: () => void;
}
declare const pulse: PulseApi;

const el = (id: string): HTMLElement => document.getElementById(id)!;
const eyes = [el("eye-l"), el("eye-r")];
const pick = (arr: string[]): string => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------- mood

type Mood = "chill" | "warm" | "hot" | "critical";

const MOODS: Record<Mood, { color: string; mouth: string; browTilt: number }> = {
  // mouth: SVG path in the creature's local coords; browTilt: degrees of angry-eyebrow
  chill: { color: "#4ade80", mouth: "M 35 62 Q 50 74 65 62", browTilt: 0 },
  warm: { color: "#facc15", mouth: "M 37 66 L 63 66", browTilt: 0 },
  hot: { color: "#fb923c", mouth: "M 35 70 Q 50 60 65 70", browTilt: 12 },
  critical: { color: "#ef4444", mouth: "M 33 72 Q 50 58 67 72", browTilt: 24 },
};

function moodFor(hottest: number): Mood {
  if (hottest < 55) return "chill";
  if (hottest < 70) return "warm";
  if (hottest < 82) return "hot";
  return "critical";
}

// ---------------------------------------------------------------- game

// XP per 2 s poll tick by mood; healthy uptime grows the creature,
// cooking it shrinks it. Stages are roughly 2 h / 8 h / 24 h / 3 d healthy.
const XP_RATE: Record<Mood, number> = { chill: 1, warm: 1, hot: 0, critical: -5 };
const PAT_XP = 25;
const PAT_XP_COOLDOWN_MS = 60_000;

const STAGES = [
  { xp: 0, name: "Blobling" },
  { xp: 3_600, name: "Sproutling" },
  { xp: 14_400, name: "Hornling" },
  { xp: 43_200, name: "Crowned" },
  { xp: 129_600, name: "Ascendant" },
];

let game: PulseGameState = { v: 1, xp: 0, patCount: 0, createdAt: Date.now() };
let stateDirty = false;

function stageIndex(xp: number): number {
  let i = 0;
  for (let k = 0; k < STAGES.length; k++) if (xp >= STAGES[k].xp) i = k;
  return i;
}

function updateXpUi(): void {
  const idx = stageIndex(game.xp);
  const next = STAGES[idx + 1];
  const base = STAGES[idx].xp;
  const pct = next ? Math.min(100, (100 * (game.xp - base)) / (next.xp - base)) : 100;
  el("xpbar").style.width = `${pct}%`;
  el("xplabel").textContent = `${STAGES[idx].name} · ${Math.round(game.xp)} xp`;
  el("acc-sprout").style.display = idx === 1 ? "" : "none";
  el("acc-horns").style.display = idx === 2 ? "" : "none";
  el("acc-crown").style.display = idx >= 3 ? "" : "none";
  el("aura").style.display = idx >= 4 ? "" : "none";
}

pulse.loadState().then((s) => {
  if (s && typeof s.xp === "number") game = s;
  updateXpUi();
});
updateXpUi();

setInterval(() => {
  if (stateDirty) {
    pulse.saveState(game);
    stateDirty = false;
  }
}, 30_000);
window.addEventListener("beforeunload", () => pulse.saveState(game));

// ---------------------------------------------------------------- speech

const LINES = {
  pat: ["hehe.", "more.", "I am a good computer.", "pat acknowledged. morale +25."],
  crit: ["I'M NOT OKAY 🔥", "this is fine. (it is not fine)", "tell my fans I loved them."],
  grind: [
    "compiling something, or did you leave Rust building again?",
    "five minutes at full tilt. I hope this is worth it.",
  ],
  spike: ["whoa. what did you just open?", "that escalated quickly."],
  bored: ["are you even using me?", "I could be mining crypt— kidding. kidding."],
  devolve: ["...I devolved. thanks for the heatstroke."],
};

let bubbleTimer: number | undefined;
let lastBubbleAt = 0;
const cooldowns: Record<string, number> = {};

function say(text: string): void {
  lastBubbleAt = Date.now();
  const b = el("bubble");
  b.textContent = text;
  b.classList.add("visible");
  clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => b.classList.remove("visible"), 6000);
}

// Trigger-gated speech: per-trigger cooldown plus a global one so it never chatters.
function quip(key: string, cooldownMs: number, text: string): void {
  const now = Date.now();
  if (now - (cooldowns[key] ?? 0) < cooldownMs) return;
  if (now - lastBubbleAt < 60_000) return;
  cooldowns[key] = now;
  say(text);
}

// ---------------------------------------------------------------- render

const samples: { t: number; load: number; hot: number }[] = [];

function fmt(n: number, unit: string): string {
  return `${Math.round(n)}${unit}`;
}

function render(v: PulseVitals): void {
  const mood = moodFor(v.hottest);
  const m = MOODS[mood];
  const now = Date.now();

  document.querySelectorAll(".skin").forEach((e) => e.setAttribute("fill", m.color));
  el("mouth").setAttribute("d", m.mouth);
  el("brow-l").setAttribute("transform", `rotate(${m.browTilt} 38 34)`);
  el("brow-r").setAttribute("transform", `rotate(${-m.browTilt} 62 34)`);
  el("creature").classList.toggle("shake", mood === "critical");

  // Breathing speeds up with CPU load: 4s at idle down to 1s flat out.
  el("creature").style.setProperty("--breath", `${4 - 3 * v.cpuLoad}s`);

  // RAM pressure past 50% makes the creature visibly chubbier.
  const chub = 1 + 0.08 * Math.max(0, (v.memUsed - 0.5) / 0.5);
  el("body").setAttribute("rx", String(40 * chub));
  el("body").setAttribute("ry", String(38 * chub));

  // Network activity twitches the ears; disk activity makes the eyes dart.
  const netActive = v.netKBps > 100;
  el("ear-l").classList.toggle("twitch", netActive);
  el("ear-r").classList.toggle("twitch", netActive);
  el("eyes").classList.toggle("dart", v.diskKBps > 2000);

  const cpu = v.temps.find((t) => t.chip === "k10temp") ?? v.temps.find((t) => t.chip === "coretemp");
  const gpu = v.temps.find((t) => t.chip === "amdgpu") ?? v.temps.find((t) => t.chip === "nvidia");
  el("stat-cpu").textContent = cpu ? fmt(cpu.celsius, "°") : "—";
  el("stat-gpu").textContent = gpu ? fmt(gpu.celsius, "°") : "—";
  el("stat-load").textContent = fmt(v.cpuLoad * 100, "%");
  el("stat-power").textContent = v.powerWatts ? fmt(v.powerWatts, "W") : "—";

  // Fan ring: spins with the fastest fan, scaled down so it reads as motion
  // rather than a blur (1200 rpm ≈ one visual revolution per 0.5 s).
  const ring = el("ring");
  const maxRpm = v.fans.reduce((mx, f) => Math.max(mx, f.rpm), 0);
  if (maxRpm > 0) {
    ring.style.display = "";
    ring.style.animationDuration = `${Math.min(8, 600 / maxRpm)}s`;
  } else {
    ring.style.display = "none";
  }
  el("fanline").textContent = v.fans.map((f) => `${f.label} ${f.rpm}rpm`).join(" · ");

  // XP tick + evolution
  const prevStage = stageIndex(game.xp);
  game.xp = Math.max(0, game.xp + XP_RATE[mood]);
  stateDirty = true;
  const newStage = stageIndex(game.xp);
  if (newStage > prevStage) {
    say(`I evolved! Behold: ${STAGES[newStage].name}. ✨`);
    pulse.saveState(game);
  } else if (newStage < prevStage) {
    say(pick(LINES.devolve));
    pulse.saveState(game);
  }
  updateXpUi();

  // Speech triggers
  samples.push({ t: now, load: v.cpuLoad, hot: v.hottest });
  while (samples.length && samples[0].t < now - 30 * 60_000) samples.shift();

  if (mood === "critical") quip("crit", 10 * 60_000, pick(LINES.crit));
  const last5m = samples.filter((h) => h.t > now - 5 * 60_000);
  if (last5m.length > 120 && last5m.every((h) => h.load > 0.85)) {
    quip("grind", 30 * 60_000, pick(LINES.grind));
  }
  const minuteAgo = samples.find((h) => h.t > now - 70_000 && h.t < now - 50_000);
  if (minuteAgo && v.hottest - minuteAgo.hot >= 12) quip("spike", 10 * 60_000, pick(LINES.spike));
  const hour = new Date().getHours();
  if (hour < 5) {
    quip("night", 8 * 3_600_000, `it's ${hour === 0 ? 12 : hour}am. neither of us has a bedtime, huh.`);
  }
  if (samples.length > 800 && samples.every((h) => h.load < 0.08)) {
    quip("bored", 60 * 60_000, pick(LINES.bored));
  }
}

pulse.onVitals(render);

// ---------------------------------------------------------------- petting

let lastPatXp = 0;
el("creature").addEventListener("click", (ev) => {
  if (isPaused) {
    say("zzz...");
    return;
  }
  const heart = document.createElement("span");
  heart.className = "heart";
  heart.textContent = "❤";
  heart.style.left = `${ev.clientX - 7}px`;
  heart.style.top = `${ev.clientY - 14}px`;
  document.body.appendChild(heart);
  setTimeout(() => heart.remove(), 1000);

  const now = Date.now();
  if (now - lastPatXp > PAT_XP_COOLDOWN_MS) {
    lastPatXp = now;
    game.xp += PAT_XP;
    game.patCount++;
    stateDirty = true;
    updateXpUi();
  }
  if (Math.random() < 0.3) say(pick(LINES.pat));
});

document.getElementById("close")!.addEventListener("click", () => pulse.quit());

// ---------------------------------------------------------------- blink/pause

let isPaused = false;
function blink(): void {
  if (!isPaused) {
    eyes.forEach((e) => e.setAttribute("ry", "0.8"));
    setTimeout(() => eyes.forEach((e) => e.setAttribute("ry", "5")), 130);
  }
  setTimeout(blink, 2500 + Math.random() * 3000);
}
setTimeout(blink, 2000);

// Paused = asleep: eyes shut, flat mouth, animations frozen, stats dimmed.
pulse.onPaused((paused) => {
  isPaused = paused;
  document.body.classList.toggle("paused", paused);
  eyes.forEach((e) => e.setAttribute("ry", paused ? "0.8" : "5"));
  if (paused) {
    el("mouth").setAttribute("d", MOODS.warm.mouth);
    el("fanline").textContent = "zZz — paused";
  } else {
    el("fanline").textContent = "";
  }
});
