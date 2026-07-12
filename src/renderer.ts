// Renderer script. Deliberately no imports/exports so tsc emits a plain
// browser script (contextIsolation is on; everything arrives via window.pulse).

interface PulseTempReading { chip: string; label: string; celsius: number }
interface PulseFanReading { chip: string; label: string; rpm: number }
interface PulseVitals {
  temps: PulseTempReading[];
  fans: PulseFanReading[];
  powerWatts: number | null;
  cpuLoad: number;
  hottest: number;
}
interface PulseApi {
  onVitals: (cb: (v: PulseVitals) => void) => void;
  onPaused: (cb: (paused: boolean) => void) => void;
  quit: () => void;
}
declare const pulse: PulseApi;

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

function pickTemp(temps: PulseTempReading[], chip: string): PulseTempReading | undefined {
  return temps.find((t) => t.chip === chip);
}

function fmt(n: number, unit: string): string {
  return `${Math.round(n)}${unit}`;
}

function render(v: PulseVitals): void {
  const mood = moodFor(v.hottest);
  const m = MOODS[mood];

  const body = document.getElementById("body")!;
  const mouth = document.getElementById("mouth")!;
  const browL = document.getElementById("brow-l")!;
  const browR = document.getElementById("brow-r")!;
  const creature = document.getElementById("creature")!;

  body.setAttribute("fill", m.color);
  mouth.setAttribute("d", m.mouth);
  browL.setAttribute("transform", `rotate(${m.browTilt} 38 34)`);
  browR.setAttribute("transform", `rotate(${-m.browTilt} 62 34)`);
  creature.classList.toggle("shake", mood === "critical");

  // Breathing speeds up with CPU load: 4s at idle down to 1s flat out.
  creature.style.setProperty("--breath", `${4 - 3 * v.cpuLoad}s`);

  const cpu = pickTemp(v.temps, "k10temp") ?? pickTemp(v.temps, "coretemp");
  const gpu = pickTemp(v.temps, "amdgpu") ?? pickTemp(v.temps, "nvidia");

  document.getElementById("stat-cpu")!.textContent = cpu ? fmt(cpu.celsius, "°") : "—";
  document.getElementById("stat-gpu")!.textContent = gpu ? fmt(gpu.celsius, "°") : "—";
  document.getElementById("stat-load")!.textContent = fmt(v.cpuLoad * 100, "%");
  document.getElementById("stat-power")!.textContent = v.powerWatts ? fmt(v.powerWatts, "W") : "—";

  const fan = v.fans[0];
  document.getElementById("fanline")!.textContent = fan ? `${fan.label}: ${fan.rpm} rpm` : "";
}

pulse.onVitals(render);

document.getElementById("close")!.addEventListener("click", () => pulse.quit());

// Blink every few seconds; a touch of randomness so it feels alive.
const eyes = [document.getElementById("eye-l")!, document.getElementById("eye-r")!];
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
    document.getElementById("mouth")!.setAttribute("d", MOODS.warm.mouth);
    document.getElementById("fanline")!.textContent = "zZz — paused";
  } else {
    document.getElementById("fanline")!.textContent = "";
  }
});
