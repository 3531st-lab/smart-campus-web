const fs = require("fs");
const path = require("path");

const sampleRate = 22050;
const seconds = 32;
const total = sampleRate * seconds;
const outputDir = path.resolve(__dirname, "../public/assets/music");
fs.mkdirSync(outputDir, { recursive: true });

const themes = {
  spring: { bpm: 92, root: 62, scale: [0, 2, 4, 7, 9], melody: [0, 2, 4, 2, 7, 4, 2, 0], wave: "sine", air: .018 },
  summer: { bpm: 108, root: 67, scale: [0, 2, 4, 7, 9], melody: [0, 4, 7, 9, 7, 4, 2, 4], wave: "pluck", air: .012 },
  autumn: { bpm: 78, root: 57, scale: [0, 3, 5, 7, 10], melody: [0, 3, 7, 5, 3, 0, 10, 7], wave: "triangle", air: .025 },
  winter: { bpm: 66, root: 60, scale: [0, 2, 3, 7, 8], melody: [0, 7, 3, 8, 7, 3, 2, 0], wave: "bell", air: .01 },
  sunset: { bpm: 84, root: 55, scale: [0, 2, 4, 7, 11], melody: [0, 4, 7, 11, 7, 4, 2, 0], wave: "warm", air: .022 },
  starry: { bpm: 58, root: 50, scale: [0, 2, 5, 7, 9], melody: [0, 7, 9, 5, 2, 7, 5, 0], wave: "glass", air: .008 }
};

function midi(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function osc(type, phase, age) {
  if (type === "triangle") return 2 * Math.asin(Math.sin(phase)) / Math.PI;
  if (type === "pluck") return (Math.sin(phase) + .35 * Math.sin(phase * 2.01)) * Math.exp(-age * 2.5);
  if (type === "bell") return (Math.sin(phase) + .45 * Math.sin(phase * 2.98) + .15 * Math.sin(phase * 5.02)) * Math.exp(-age * 1.4);
  if (type === "warm") return .75 * Math.sin(phase) + .2 * Math.sin(phase * 2) + .08 * Math.sin(phase * .5);
  if (type === "glass") return .72 * Math.sin(phase) + .25 * Math.sin(phase * 2.5) + .12 * Math.sin(phase * 4.03);
  return Math.sin(phase);
}

function fade(age, duration, attack = .08, release = .45) {
  return Math.min(1, age / attack) * Math.min(1, Math.max(0, duration - age) / release);
}

function render(name, spec) {
  const data = new Float32Array(total);
  const beat = 60 / spec.bpm;
  const rng = (() => {
    let value = name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 1);
    return () => ((value = (value * 16807) % 2147483647) - 1) / 2147483646;
  })();

  const addNote = (start, duration, note, volume, type = spec.wave, panPulse = 0) => {
    const frequency = midi(note);
    const begin = Math.max(0, Math.floor(start * sampleRate));
    const end = Math.min(total, Math.floor((start + duration) * sampleRate));
    for (let index = begin; index < end; index += 1) {
      const age = (index - begin) / sampleRate;
      const phase = Math.PI * 2 * frequency * age + Math.sin(age * 1.7) * panPulse;
      data[index] += osc(type, phase, age) * fade(age, duration) * volume;
    }
  };

  for (let bar = 0; bar < Math.ceil(seconds / (beat * 4)); bar += 1) {
    const barStart = bar * beat * 4;
    const chordRoot = spec.root + [0, 5, 7, 3][bar % 4];
    [0, 7, 12].forEach((offset, index) => addNote(barStart, beat * 3.8, chordRoot + offset, .035 / (index + 1), "warm", .08));
    for (let step = 0; step < 8; step += 1) {
      const start = barStart + step * beat / 2;
      const note = spec.root + spec.melody[(bar * 3 + step) % spec.melody.length] + (step === 7 ? 12 : 0);
      addNote(start, beat * (name === "starry" ? 1.8 : .82), note, name === "summer" ? .12 : .09, spec.wave, .12);
      if (name === "summer" || name === "sunset") addNote(start, .08, spec.root - 12, .045, "pluck");
    }
  }

  for (let index = 0; index < total; index += 1) {
    const time = index / sampleRate;
    const breeze = (rng() * 2 - 1) * spec.air * (.5 + .5 * Math.sin(time * .21));
    data[index] += breeze;
    data[index] *= Math.min(1, time / 1.2, (seconds - time) / 1.8);
  }

  const buffer = Buffer.alloc(44 + total * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + total * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(total * 2, 40);
  for (let index = 0; index < total; index += 1) {
    const sample = Math.max(-1, Math.min(1, data[index] * 1.6));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  fs.writeFileSync(path.join(outputDir, `${name}.wav`), buffer);
}

Object.entries(themes).forEach(([name, spec]) => render(name, spec));
console.log(`Generated ${Object.keys(themes).length} original instrumental tracks in ${outputDir}`);
