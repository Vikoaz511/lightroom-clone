const viewCanvas = document.getElementById("viewCanvas");
const stageInner = document.getElementById("stageInner");
const placeholder = document.getElementById("placeholder");
const fileInput = document.getElementById("fileInput");
const resetBtn = document.getElementById("resetBtn");
const compareBtn = document.getElementById("compareBtn");
const downloadBtn = document.getElementById("downloadBtn");
const exportFormat = document.getElementById("exportFormat");
const exportQuality = document.getElementById("exportQuality");
const statusEl = document.getElementById("status");
const zoomEl = document.getElementById("zoom");
const zoomValue = document.getElementById("zoomValue");
const fitBtn = document.getElementById("fitBtn");
const actualBtn = document.getElementById("actualBtn");

const basicControls = document.getElementById("basicControls");
const colorControls = document.getElementById("colorControls");
const curveControls = document.getElementById("curveControls");
const gradingControls = document.getElementById("gradingControls");
const cropControls = document.getElementById("cropControls");
const lensControls = document.getElementById("lensControls");
const detailControls = document.getElementById("detailControls");
const effectsControls = document.getElementById("effectsControls");
const transformControls = document.getElementById("transformControls");
const presetSelect = document.getElementById("presetSelect");
const applyPresetBtn = document.getElementById("applyPresetBtn");
const exportPresetBtn = document.getElementById("exportPresetBtn");
const importPresetBtn = document.getElementById("importPresetBtn");
const presetFileInput = document.getElementById("presetFileInput");

const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const viewCtx = viewCanvas.getContext("2d", { alpha: true });
const bufferCanvas = document.createElement("canvas");
const bufferCtx = bufferCanvas.getContext("2d", { willReadFrequently: false });
let lastViewW = 0;
let lastViewH = 0;
let lastZoom = 0;

function mod360(v) {
  const x = v % 360;
  return x < 0 ? x + 360 : x;
}

function rgbToHsl255(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToRgb255(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (0 <= hp && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (1 <= hp && hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (2 <= hp && hp < 3) [r1, g1, b1] = [0, c, x];
  else if (3 <= hp && hp < 4) [r1, g1, b1] = [0, x, c];
  else if (4 <= hp && hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return [clamp255((r1 + m) * 255), clamp255((g1 + m) * 255), clamp255((b1 + m) * 255)];
}

function hueDistDeg(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hueSatToRgb01(h, s) {
  const [r, g, b] = hslToRgb255(h, clamp01(s), 0.5);
  return [r / 255, g / 255, b / 255];
}

function buildToneCurveLut(s) {
  const a0 = 0;
  const a1 = 64;
  const a2 = 128;
  const a3 = 192;
  const a4 = 255;

  const d0 = (Number(s.curveShadows || 0) / 100) * 40;
  const d1 = (Number(s.curveDarks || 0) / 100) * 35;
  const d2 = 0;
  const d3 = (Number(s.curveLights || 0) / 100) * 35;
  const d4 = (Number(s.curveHighlights || 0) / 100) * 40;

  const y0 = clamp255(a0 + d0);
  const y1 = clamp255(a1 + d1);
  const y2 = clamp255(a2 + d2);
  const y3 = clamp255(a3 + d3);
  const y4 = clamp255(a4 + d4);

  const xs = [a0, a1, a2, a3, a4];
  const ys = [y0, y1, y2, y3, y4];

  // Catmull-Rom spline for smooth curve through the 5 anchors
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let seg = 0;
    if (i >= a1) seg = 1;
    if (i >= a2) seg = 2;
    if (i >= a3) seg = 3;
    const x0 = xs[Math.max(0, seg - 1)];
    const x1 = xs[seg];
    const x2 = xs[seg + 1];
    const x3 = xs[Math.min(4, seg + 2)];
    const t = x2 !== x1 ? (i - x1) / (x2 - x1) : 0;
    const p0 = ys[Math.max(0, seg - 1)];
    const p1 = ys[seg];
    const p2 = ys[seg + 1];
    const p3 = ys[Math.min(4, seg + 2)];
    const tt = t * t;
    const ttt = tt * t;
    const v =
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * tt +
        (-p0 + 3 * p1 - 3 * p2 + p3) * ttt);
    lut[i] = clamp255(v);
  }
  lut[0] = y0;
  lut[255] = y4;
  return lut;
}

function extLower(name) {
  const m = String(name || "").match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

function isHeicFile(file) {
  const t = (file.type || "").toLowerCase();
  const ext = extLower(file.name);
  return t.includes("heic") || t.includes("heif") || ext === "heic" || ext === "heif";
}

function isRawFile(file) {
  const ext = extLower(file.name);
  return (
    ext === "dng" ||
    ext === "cr2" ||
    ext === "nef" ||
    ext === "arw" ||
    ext === "rw2" ||
    ext === "orf" ||
    ext === "raf" ||
    ext === "pef" ||
    ext === "srw"
  );
}

let heic2anyReady = null;
async function ensureHeic2any() {
  if (typeof window.heic2any === "function") return window.heic2any;
  if (heic2anyReady) return heic2anyReady;
  heic2anyReady = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/heic2any/dist/heic2any.min.js";
    s.async = true;
    s.onload = () => resolve(window.heic2any);
    s.onerror = () => reject(new Error("Failed to load heic2any"));
    document.head.appendChild(s);
  });
  return heic2anyReady;
}

let libRawModuleReady = null;
async function ensureLibRaw() {
  if (libRawModuleReady) return libRawModuleReady;
  libRawModuleReady = import("https://esm.sh/libraw-wasm@1.1.2");
  return libRawModuleReady;
}

async function decodeRawToBitmap(file, bytes) {
  const mod = await ensureLibRaw();
  const LibRaw = mod.default || mod.LibRaw || mod;
  const lr = new LibRaw();
  await lr.open(new Uint8Array(bytes), { noAutoBright: false });

  const rawImg = await lr.imageData();
  const w = rawImg.width;
  const h = rawImg.height;
  const colors = rawImg.colors || 3;
  const src = rawImg.data;

  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += colors) {
    const o = i * 4;
    rgba[o] = src[j];
    rgba[o + 1] = src[j + 1] ?? src[j];
    rgba[o + 2] = src[j + 2] ?? src[j];
    rgba[o + 3] = 255;
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
  return await createImageBitmap(canvas);
}

const state = {
  loaded: false,
  compare: false,
  zoom: 1,
  fitZoom: 1,
  workMaxDim: 1800,
  exportMaxDim: 6000,
  imageBitmap: null,
  imageName: "image",
  w: 0,
  h: 0,
  fullW: 0,
  fullH: 0,
  base: null,
  outImageData: null,
  settings: {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    texture: 0,
    clarity: 0,
    dehaze: 0,
    sharpness: 0,
    sharpenMasking: 0,
    noiseReduction: 0,
    colorNoiseReduction: 0,
    vignette: 0,
    grain: 0,
    cropLeft: 0,
    cropTop: 0,
    cropRight: 0,
    cropBottom: 0,
    lensDistortion: 0,
    lensChromaticAberration: 0,
    lensVignette: 0,
    curveShadows: 0,
    curveDarks: 0,
    curveLights: 0,
    curveHighlights: 0,
    gradeShadowsHue: 220,
    gradeShadowsSat: 0,
    gradeMidHue: 40,
    gradeMidSat: 0,
    gradeHighHue: 50,
    gradeHighSat: 0,
    gradeBalance: 0,
    hslRedHue: 0, hslRedSat: 0, hslRedLum: 0,
    hslOrangeHue: 0, hslOrangeSat: 0, hslOrangeLum: 0,
    hslYellowHue: 0, hslYellowSat: 0, hslYellowLum: 0,
    hslGreenHue: 0, hslGreenSat: 0, hslGreenLum: 0,
    hslAquaHue: 0, hslAquaSat: 0, hslAquaLum: 0,
    hslBlueHue: 0, hslBlueSat: 0, hslBlueLum: 0,
    hslPurpleHue: 0, hslPurpleSat: 0, hslPurpleLum: 0,
    hslMagentaHue: 0, hslMagentaSat: 0, hslMagentaLum: 0,
    rotate: 0,
    flipH: 0,
    flipV: 0,
  },
};

// =============================================================================
// PRESETS — all researched across Lightroom, VSCO, Adobe, Mastin Labs, Gridfiti,
// Presetpedia, Presetlove, Imagen AI, PHLEARN. Every preset uses the full
// attribute set: Basic · Effects · Detail · Tone Curve · Color Grading · HSL · Lens.
// =============================================================================
const PRESETS = [
  { id: "none", name: "None (no changes)", settings: {} },

  // ---------------------------------------------------------------------------
  // Kodak Portra 400 — warm skin, low contrast, fine grain, olive greens
  // Sources: Mastin Labs, VSCO KP2/KP4, Gridfiti Portra 400, Imagen AI
  // ---------------------------------------------------------------------------
  {
    id: "portra-400",
    name: "Kodak Portra 400",
    settings: {
      exposure: 4, contrast: -8, highlights: -20, shadows: 22,
      whites: -8, blacks: -6, temperature: 14, tint: 6,
      vibrance: 8, saturation: -6,
      texture: -4, clarity: -6, dehaze: 0, vignette: -8, grain: 22,
      sharpness: 22, sharpenMasking: 55, noiseReduction: 10, colorNoiseReduction: 14,
      curveShadows: 12, curveDarks: 4, curveLights: -4, curveHighlights: -10,
      gradeShadowsHue: 26, gradeShadowsSat: 6,
      gradeMidHue: 32, gradeMidSat: 14,
      gradeHighHue: 40, gradeHighSat: 10, gradeBalance: 12,
      hslRedHue: 6, hslRedSat: 10, hslRedLum: 8,
      hslOrangeHue: 8, hslOrangeSat: 14, hslOrangeLum: 10,
      hslYellowHue: 4, hslYellowSat: -4, hslYellowLum: 4,
      hslGreenHue: 8, hslGreenSat: -14, hslGreenLum: -6,
      hslAquaHue: 4, hslAquaSat: -10, hslAquaLum: 0,
      hslBlueHue: 2, hslBlueSat: -8, hslBlueLum: 2,
      hslPurpleHue: 0, hslPurpleSat: -6, hslPurpleLum: 0,
      hslMagentaHue: 6, hslMagentaSat: -4, hslMagentaLum: 2,
      lensDistortion: 0, lensChromaticAberration: 4, lensVignette: -4,
    },
  },

  // ---------------------------------------------------------------------------
  // Fuji Pro 400H — cool/green bias, airy pastels, clean skin, lifted shadows
  // Sources: VSCO FP8, Mastin Labs Fuji pack, LooksLikeFilm community
  // ---------------------------------------------------------------------------
  {
    id: "fuji-400h",
    name: "Fuji Pro 400H",
    settings: {
      exposure: 6, contrast: -10, highlights: -24, shadows: 30,
      whites: -14, blacks: 8, temperature: -10, tint: 4,
      vibrance: -6, saturation: -10,
      texture: -8, clarity: -10, dehaze: -6, vignette: -6, grain: 16,
      sharpness: 16, sharpenMasking: 60, noiseReduction: 14, colorNoiseReduction: 18,
      curveShadows: 20, curveDarks: 10, curveLights: -6, curveHighlights: -18,
      gradeShadowsHue: 158, gradeShadowsSat: 12,
      gradeMidHue: 160, gradeMidSat: 6,
      gradeHighHue: 42, gradeHighSat: 8, gradeBalance: -8,
      hslRedHue: 0, hslRedSat: -6, hslRedLum: 6,
      hslOrangeHue: 2, hslOrangeSat: -8, hslOrangeLum: 8,
      hslYellowHue: 4, hslYellowSat: -12, hslYellowLum: 6,
      hslGreenHue: 8, hslGreenSat: -10, hslGreenLum: 6,
      hslAquaHue: -6, hslAquaSat: 8, hslAquaLum: 8,
      hslBlueHue: -4, hslBlueSat: -8, hslBlueLum: 10,
      hslPurpleHue: 0, hslPurpleSat: -10, hslPurpleLum: 4,
      hslMagentaHue: -4, hslMagentaSat: -8, hslMagentaLum: 4,
      lensDistortion: 0, lensChromaticAberration: 4, lensVignette: -4,
    },
  },

  // ---------------------------------------------------------------------------
  // Dark & Moody — cool temp, shadow crush, blue-teal grade, stripped warmth
  // Sources: Presetpedia moody guide, Wilde Presets, Flothemes "Rover", VSCO dark
  // ---------------------------------------------------------------------------
  {
    id: "dark-moody",
    name: "Dark & Moody",
    settings: {
      exposure: -4, contrast: 26, highlights: -50, shadows: 14,
      whites: -18, blacks: -30, temperature: -16, tint: -4,
      vibrance: 6, saturation: -14,
      texture: 18, clarity: 28, dehaze: 14, vignette: -32, grain: 18,
      sharpness: 24, sharpenMasking: 38, noiseReduction: 12, colorNoiseReduction: 16,
      curveShadows: -20, curveDarks: -10, curveLights: 6, curveHighlights: -22,
      gradeShadowsHue: 200, gradeShadowsSat: 26,
      gradeMidHue: 204, gradeMidSat: 10,
      gradeHighHue: 34, gradeHighSat: 16, gradeBalance: -18,
      hslRedHue: -4, hslRedSat: -10, hslRedLum: -6,
      hslOrangeHue: 0, hslOrangeSat: -20, hslOrangeLum: -8,
      hslYellowHue: 0, hslYellowSat: -22, hslYellowLum: -6,
      hslGreenHue: -6, hslGreenSat: -14, hslGreenLum: -10,
      hslAquaHue: -4, hslAquaSat: 20, hslAquaLum: -4,
      hslBlueHue: 4, hslBlueSat: 24, hslBlueLum: -8,
      hslPurpleHue: 0, hslPurpleSat: -8, hslPurpleLum: -4,
      hslMagentaHue: 0, hslMagentaSat: -12, hslMagentaLum: -6,
      lensDistortion: 0, lensChromaticAberration: 6, lensVignette: -14,
    },
  },

  // ---------------------------------------------------------------------------
  // Golden Hour — #1 lifestyle preset; burning sky, boosted oranges, warm glow
  // Sources: Artifact Uprising 07, Pretty Presets, Wilde, Lou & Marks "Boho"
  // ---------------------------------------------------------------------------
  {
    id: "golden-hour",
    name: "Golden Hour",
    settings: {
      exposure: 6, contrast: 4, highlights: -8, shadows: 18,
      whites: 14, blacks: -10, temperature: 40, tint: 10,
      vibrance: 26, saturation: 8,
      texture: 6, clarity: 2, dehaze: -4, vignette: -14, grain: 8,
      sharpness: 18, sharpenMasking: 36, noiseReduction: 8, colorNoiseReduction: 10,
      curveShadows: 16, curveDarks: 8, curveLights: 6, curveHighlights: -6,
      gradeShadowsHue: 34, gradeShadowsSat: 16,
      gradeMidHue: 38, gradeMidSat: 22,
      gradeHighHue: 44, gradeHighSat: 26, gradeBalance: 20,
      hslRedHue: 8, hslRedSat: 18, hslRedLum: 10,
      hslOrangeHue: 10, hslOrangeSat: 30, hslOrangeLum: 14,
      hslYellowHue: 8, hslYellowSat: 26, hslYellowLum: 12,
      hslGreenHue: 10, hslGreenSat: -8, hslGreenLum: 4,
      hslAquaHue: 4, hslAquaSat: -14, hslAquaLum: 2,
      hslBlueHue: 4, hslBlueSat: -18, hslBlueLum: -4,
      hslPurpleHue: 0, hslPurpleSat: -10, hslPurpleLum: 0,
      hslMagentaHue: 8, hslMagentaSat: 12, hslMagentaLum: 4,
      lensDistortion: 0, lensChromaticAberration: 4, lensVignette: -8,
    },
  },

  // ---------------------------------------------------------------------------
  // VSCO Fade — lifted blacks, green-teal shadows, muted all-channel HSL
  // Sources: VSCO A4/A5/F1-F3, Presetpedia VSCO analysis, CreativeBloq 2024
  // ---------------------------------------------------------------------------
  {
    id: "vsco-fade",
    name: "VSCO Fade",
    settings: {
      exposure: 2, contrast: -16, highlights: -14, shadows: 32,
      whites: -20, blacks: 28, temperature: -6, tint: 2,
      vibrance: -14, saturation: -18,
      texture: -10, clarity: -16, dehaze: -8, vignette: -10, grain: 14,
      sharpness: 8, sharpenMasking: 55, noiseReduction: 12, colorNoiseReduction: 14,
      curveShadows: 26, curveDarks: 12, curveLights: -10, curveHighlights: -22,
      gradeShadowsHue: 152, gradeShadowsSat: 14,
      gradeMidHue: 160, gradeMidSat: 8,
      gradeHighHue: 38, gradeHighSat: 6, gradeBalance: -6,
      hslRedHue: 2, hslRedSat: -10, hslRedLum: 4,
      hslOrangeHue: 2, hslOrangeSat: -12, hslOrangeLum: 6,
      hslYellowHue: 4, hslYellowSat: -16, hslYellowLum: 4,
      hslGreenHue: 6, hslGreenSat: -18, hslGreenLum: 2,
      hslAquaHue: 2, hslAquaSat: -14, hslAquaLum: 4,
      hslBlueHue: 0, hslBlueSat: -16, hslBlueLum: 6,
      hslPurpleHue: 0, hslPurpleSat: -14, hslPurpleLum: 2,
      hslMagentaHue: 0, hslMagentaSat: -12, hslMagentaLum: 2,
      lensDistortion: 0, lensChromaticAberration: 0, lensVignette: -6,
    },
  },

  // ---------------------------------------------------------------------------
  // Film Noir — full desaturation, extreme contrast, silver grade, deep vignette
  // Sources: PHLEARN Film Noir Pack, Presetpedia dark guide, Presets.io, Adobe
  // ---------------------------------------------------------------------------
  {
    id: "film-noir",
    name: "Film Noir",
    settings: {
      exposure: -4, contrast: 40, highlights: -28, shadows: 6,
      whites: 12, blacks: -36, temperature: 0, tint: 0,
      vibrance: -100, saturation: -100,
      texture: 16, clarity: 32, dehaze: 10, vignette: -40, grain: 24,
      sharpness: 36, sharpenMasking: 42, noiseReduction: 6, colorNoiseReduction: 8,
      curveShadows: -24, curveDarks: -12, curveLights: 14, curveHighlights: -10,
      gradeShadowsHue: 218, gradeShadowsSat: 12,
      gradeMidHue: 215, gradeMidSat: 5,
      gradeHighHue: 44, gradeHighSat: 6, gradeBalance: -10,
      hslRedHue: 0, hslRedSat: 0, hslRedLum: 22,
      hslOrangeHue: 0, hslOrangeSat: 0, hslOrangeLum: 18,
      hslYellowHue: 0, hslYellowSat: 0, hslYellowLum: 8,
      hslGreenHue: 0, hslGreenSat: 0, hslGreenLum: -18,
      hslAquaHue: 0, hslAquaSat: 0, hslAquaLum: -14,
      hslBlueHue: 0, hslBlueSat: 0, hslBlueLum: -28,
      hslPurpleHue: 0, hslPurpleSat: 0, hslPurpleLum: -10,
      hslMagentaHue: 0, hslMagentaSat: 0, hslMagentaLum: 8,
      lensDistortion: 0, lensChromaticAberration: 0, lensVignette: -16,
    },
  },

  // ---------------------------------------------------------------------------
  // Vintage 70s — yellow-orange analog warmth, green-to-yellow shift, heavy grain
  // Sources: Gridfiti "70s Vibe" (2024), Presetlove 1970s, Flourish Presets guide
  // ---------------------------------------------------------------------------
  {
    id: "vintage-70s",
    name: "Vintage 70s",
    settings: {
      exposure: 2, contrast: -8, highlights: -16, shadows: 24,
      whites: -10, blacks: 14, temperature: 28, tint: 10,
      vibrance: -12, saturation: -14,
      texture: -4, clarity: -8, dehaze: -4, vignette: -14, grain: 32,
      sharpness: 14, sharpenMasking: 48, noiseReduction: 8, colorNoiseReduction: 10,
      curveShadows: 18, curveDarks: 8, curveLights: -4, curveHighlights: -12,
      gradeShadowsHue: 44, gradeShadowsSat: 18,
      gradeMidHue: 38, gradeMidSat: 22,
      gradeHighHue: 34, gradeHighSat: 16, gradeBalance: 8,
      hslRedHue: 8, hslRedSat: 10, hslRedLum: 6,
      hslOrangeHue: 10, hslOrangeSat: 16, hslOrangeLum: 8,
      hslYellowHue: -6, hslYellowSat: 18, hslYellowLum: 10,
      hslGreenHue: -18, hslGreenSat: -8, hslGreenLum: -4,
      hslAquaHue: -8, hslAquaSat: -14, hslAquaLum: -6,
      hslBlueHue: -4, hslBlueSat: -22, hslBlueLum: -10,
      hslPurpleHue: 0, hslPurpleSat: -14, hslPurpleLum: -4,
      hslMagentaHue: 6, hslMagentaSat: -6, hslMagentaLum: 2,
      lensDistortion: -6, lensChromaticAberration: 8, lensVignette: -8,
    },
  },

  // ---------------------------------------------------------------------------
  // Desert Dunes — vivid orange sands, punchy contrast, deep blue sky
  // Sources: Presetlove Desert Landscapes, Presetsfactory desert, Gridfiti OT
  // ---------------------------------------------------------------------------
  {
    id: "desert-dunes",
    name: "Desert Dunes",
    settings: {
      exposure: 3, contrast: 22, highlights: -26, shadows: 14,
      whites: 14, blacks: -18, temperature: 32, tint: 6,
      vibrance: 28, saturation: 12,
      texture: 28, clarity: 22, dehaze: 24, vignette: -16, grain: 6,
      sharpness: 28, sharpenMasking: 18, noiseReduction: 6, colorNoiseReduction: 8,
      curveShadows: -10, curveDarks: -4, curveLights: 8, curveHighlights: -8,
      gradeShadowsHue: 28, gradeShadowsSat: 20,
      gradeMidHue: 34, gradeMidSat: 14,
      gradeHighHue: 42, gradeHighSat: 10, gradeBalance: -4,
      hslRedHue: 6, hslRedSat: 28, hslRedLum: 4,
      hslOrangeHue: 8, hslOrangeSat: 36, hslOrangeLum: 8,
      hslYellowHue: 10, hslYellowSat: 24, hslYellowLum: 6,
      hslGreenHue: 8, hslGreenSat: -20, hslGreenLum: -8,
      hslAquaHue: -4, hslAquaSat: -12, hslAquaLum: -6,
      hslBlueHue: 4, hslBlueSat: 30, hslBlueLum: -12,
      hslPurpleHue: 0, hslPurpleSat: -8, hslPurpleLum: -4,
      hslMagentaHue: 0, hslMagentaSat: -6, hslMagentaLum: -2,
      lensDistortion: 6, lensChromaticAberration: 6, lensVignette: -10,
    },
  },

  // ---------------------------------------------------------------------------
  // Pastel Dream — pink-lavender shadows, boosted purples/magentas, dreamy glow
  // Sources: Gridfiti Retro Radiance/Vintage Velvet, Presetlove 79th & 1985
  // ---------------------------------------------------------------------------
  {
    id: "pastel-dream",
    name: "Pastel Dream",
    settings: {
      exposure: 8, contrast: -14, highlights: -20, shadows: 26,
      whites: -6, blacks: 12, temperature: 4, tint: 12,
      vibrance: -8, saturation: -6,
      texture: -12, clarity: -14, dehaze: -6, vignette: -8, grain: 10,
      sharpness: 12, sharpenMasking: 58, noiseReduction: 14, colorNoiseReduction: 16,
      curveShadows: 18, curveDarks: 8, curveLights: -6, curveHighlights: -14,
      gradeShadowsHue: 296, gradeShadowsSat: 18,
      gradeMidHue: 302, gradeMidSat: 12,
      gradeHighHue: 320, gradeHighSat: 8, gradeBalance: 6,
      hslRedHue: 4, hslRedSat: -4, hslRedLum: 8,
      hslOrangeHue: 4, hslOrangeSat: -8, hslOrangeLum: 10,
      hslYellowHue: 0, hslYellowSat: -14, hslYellowLum: 6,
      hslGreenHue: -6, hslGreenSat: -22, hslGreenLum: 4,
      hslAquaHue: -4, hslAquaSat: -16, hslAquaLum: 6,
      hslBlueHue: -12, hslBlueSat: 12, hslBlueLum: 8,
      hslPurpleHue: -8, hslPurpleSat: 24, hslPurpleLum: 10,
      hslMagentaHue: -6, hslMagentaSat: 28, hslMagentaLum: 8,
      lensDistortion: 0, lensChromaticAberration: 4, lensVignette: -4,
    },
  },

  // ---------------------------------------------------------------------------
  // Kodak Gold 200 — yellow-gold bias, punchier than Portra, consumer warmth
  // Sources: Imagen AI Kodak Gold 200, Gridfiti Gold pack (2024), Presetlove film
  // ---------------------------------------------------------------------------
  {
    id: "kodak-gold-200",
    name: "Kodak Gold 200",
    settings: {
      exposure: 3, contrast: 8, highlights: -18, shadows: 18,
      whites: -4, blacks: -8, temperature: 20, tint: 8,
      vibrance: 12, saturation: -4,
      texture: -2, clarity: -2, dehaze: 0, vignette: -10, grain: 26,
      sharpness: 20, sharpenMasking: 45, noiseReduction: 10, colorNoiseReduction: 12,
      curveShadows: 10, curveDarks: 4, curveLights: -2, curveHighlights: -8,
      gradeShadowsHue: 50, gradeShadowsSat: 16,
      gradeMidHue: 44, gradeMidSat: 20,
      gradeHighHue: 38, gradeHighSat: 14, gradeBalance: 10,
      hslRedHue: 6, hslRedSat: 12, hslRedLum: 6,
      hslOrangeHue: 8, hslOrangeSat: 18, hslOrangeLum: 10,
      hslYellowHue: -4, hslYellowSat: 22, hslYellowLum: 12,
      hslGreenHue: -12, hslGreenSat: -10, hslGreenLum: -4,
      hslAquaHue: 0, hslAquaSat: -12, hslAquaLum: 0,
      hslBlueHue: 2, hslBlueSat: -14, hslBlueLum: -4,
      hslPurpleHue: 0, hslPurpleSat: -8, hslPurpleLum: -2,
      hslMagentaHue: 4, hslMagentaSat: -4, hslMagentaLum: 2,
      lensDistortion: 0, lensChromaticAberration: 6, lensVignette: -6,
    },
  },

  // ---------------------------------------------------------------------------
  // Landscape — punchy outdoor scene, vivid sky blues, recovered highlights
  // ---------------------------------------------------------------------------
  {
    id: "landscape",
    name: "Landscape",
    settings: {
      exposure: 2, contrast: 18, highlights: -22, shadows: 16,
      whites: 12, blacks: -14, temperature: -8, tint: 2,
      vibrance: 32, saturation: 8,
      texture: 24, clarity: 16, dehaze: 18, vignette: -12, grain: 0,
      sharpness: 30, sharpenMasking: 20, noiseReduction: 8, colorNoiseReduction: 12,
      curveShadows: 8, curveDarks: 4, curveLights: -6, curveHighlights: -14,
      gradeShadowsHue: 210, gradeShadowsSat: 18,
      gradeMidHue: 40, gradeMidSat: 6,
      gradeHighHue: 46, gradeHighSat: 14, gradeBalance: -10,
      hslRedHue: 0, hslRedSat: 6, hslRedLum: 0,
      hslOrangeHue: 4, hslOrangeSat: 10, hslOrangeLum: 2,
      hslYellowHue: -4, hslYellowSat: 18, hslYellowLum: 4,
      hslGreenHue: 6, hslGreenSat: 22, hslGreenLum: -4,
      hslAquaHue: -8, hslAquaSat: 16, hslAquaLum: 4,
      hslBlueHue: 4, hslBlueSat: 28, hslBlueLum: -8,
      hslPurpleHue: 0, hslPurpleSat: -4, hslPurpleLum: 2,
      hslMagentaHue: 0, hslMagentaSat: -4, hslMagentaLum: 0,
      lensDistortion: 4, lensChromaticAberration: 8, lensVignette: -6,
    },
  },

  // ---------------------------------------------------------------------------
  // Rain — overcast cold street, desaturated, blue-grey grade, heavy grain
  // ---------------------------------------------------------------------------
  {
    id: "rain",
    name: "Rain",
    settings: {
      exposure: -2, contrast: 12, highlights: -24, shadows: 20,
      whites: -10, blacks: 4, temperature: -28, tint: -8,
      vibrance: -10, saturation: -22,
      texture: 18, clarity: 18, dehaze: 16, vignette: -20, grain: 28,
      sharpness: 16, sharpenMasking: 20, noiseReduction: 14, colorNoiseReduction: 18,
      curveShadows: 14, curveDarks: 6, curveLights: -8, curveHighlights: -16,
      gradeShadowsHue: 214, gradeShadowsSat: 22,
      gradeMidHue: 210, gradeMidSat: 12,
      gradeHighHue: 205, gradeHighSat: 8, gradeBalance: -5,
      hslRedHue: 0, hslRedSat: -14, hslRedLum: -6,
      hslOrangeHue: 0, hslOrangeSat: -22, hslOrangeLum: -8,
      hslYellowHue: 0, hslYellowSat: -20, hslYellowLum: -4,
      hslGreenHue: -4, hslGreenSat: -10, hslGreenLum: -4,
      hslAquaHue: -4, hslAquaSat: 14, hslAquaLum: 6,
      hslBlueHue: 2, hslBlueSat: 20, hslBlueLum: 4,
      hslPurpleHue: 0, hslPurpleSat: -6, hslPurpleLum: 0,
      hslMagentaHue: 0, hslMagentaSat: -10, hslMagentaLum: -4,
      lensDistortion: -4, lensChromaticAberration: 10, lensVignette: -10,
    },
  },

  // ---------------------------------------------------------------------------
  // Cyberpunk — neon-lit urban night, extreme vibrance, purple/cyan/magenta split
  // ---------------------------------------------------------------------------
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    settings: {
      exposure: 4, contrast: 28, highlights: -18, shadows: 8,
      whites: 16, blacks: -28, temperature: -22, tint: 30,
      vibrance: 46, saturation: 18,
      texture: 22, clarity: 20, dehaze: 30, vignette: -16, grain: 14,
      sharpness: 26, sharpenMasking: 14, noiseReduction: 8, colorNoiseReduction: 12,
      curveShadows: -20, curveDarks: -8, curveLights: 12, curveHighlights: 10,
      gradeShadowsHue: 272, gradeShadowsSat: 36,
      gradeMidHue: 186, gradeMidSat: 20,
      gradeHighHue: 312, gradeHighSat: 30, gradeBalance: 0,
      hslRedHue: -10, hslRedSat: 30, hslRedLum: 6,
      hslOrangeHue: -14, hslOrangeSat: 16, hslOrangeLum: -4,
      hslYellowHue: -8, hslYellowSat: 10, hslYellowLum: -2,
      hslGreenHue: 10, hslGreenSat: 14, hslGreenLum: -6,
      hslAquaHue: -12, hslAquaSat: 42, hslAquaLum: 10,
      hslBlueHue: 8, hslBlueSat: 36, hslBlueLum: -4,
      hslPurpleHue: -8, hslPurpleSat: 46, hslPurpleLum: 8,
      hslMagentaHue: -6, hslMagentaSat: 48, hslMagentaLum: 6,
      lensDistortion: 0, lensChromaticAberration: 18, lensVignette: -14,
    },
  },

  // ---------------------------------------------------------------------------
  // Warm Portrait — soft skin, peachy grade, high sharpen masking, warm shadows
  // ---------------------------------------------------------------------------
  {
    id: "warm-portrait",
    name: "Warm Portrait",
    settings: {
      exposure: 4, contrast: 8, highlights: -24, shadows: 20,
      whites: 10, blacks: -10, temperature: 30, tint: 8,
      vibrance: 24, saturation: 4,
      texture: -8, clarity: 6, dehaze: 4, vignette: -16, grain: 4,
      sharpness: 20, sharpenMasking: 65, noiseReduction: 12, colorNoiseReduction: 16,
      curveShadows: 14, curveDarks: 8, curveLights: 4, curveHighlights: -10,
      gradeShadowsHue: 24, gradeShadowsSat: 10,
      gradeMidHue: 32, gradeMidSat: 16,
      gradeHighHue: 38, gradeHighSat: 14, gradeBalance: 15,
      hslRedHue: 4, hslRedSat: 14, hslRedLum: 8,
      hslOrangeHue: 6, hslOrangeSat: 18, hslOrangeLum: 10,
      hslYellowHue: 4, hslYellowSat: 8, hslYellowLum: 4,
      hslGreenHue: 0, hslGreenSat: -10, hslGreenLum: -4,
      hslAquaHue: 0, hslAquaSat: -8, hslAquaLum: -2,
      hslBlueHue: 0, hslBlueSat: -6, hslBlueLum: -2,
      hslPurpleHue: 0, hslPurpleSat: -4, hslPurpleLum: 0,
      hslMagentaHue: 8, hslMagentaSat: 10, hslMagentaLum: 4,
      lensDistortion: 0, lensChromaticAberration: 6, lensVignette: -10,
    },
  },

  // ---------------------------------------------------------------------------
  // Cinematic Teal — teal-orange split grade, crushed blacks, filmic S-curve
  // ---------------------------------------------------------------------------
  {
    id: "cinematic-teal",
    name: "Cinematic Teal",
    settings: {
      exposure: 2, contrast: 20, highlights: -30, shadows: 8,
      whites: 10, blacks: -20, temperature: -16, tint: -4,
      vibrance: 14, saturation: -8,
      texture: 12, clarity: 12, dehaze: 16, vignette: -24, grain: 16,
      sharpness: 24, sharpenMasking: 35, noiseReduction: 10, colorNoiseReduction: 14,
      curveShadows: -18, curveDarks: -8, curveLights: 8, curveHighlights: -14,
      gradeShadowsHue: 186, gradeShadowsSat: 32,
      gradeMidHue: 190, gradeMidSat: 14,
      gradeHighHue: 34, gradeHighSat: 24, gradeBalance: -15,
      hslRedHue: 0, hslRedSat: -6, hslRedLum: -2,
      hslOrangeHue: 6, hslOrangeSat: 14, hslOrangeLum: 2,
      hslYellowHue: 0, hslYellowSat: -10, hslYellowLum: -4,
      hslGreenHue: -8, hslGreenSat: -14, hslGreenLum: -6,
      hslAquaHue: -10, hslAquaSat: 28, hslAquaLum: -4,
      hslBlueHue: 8, hslBlueSat: 22, hslBlueLum: -10,
      hslPurpleHue: 0, hslPurpleSat: -8, hslPurpleLum: -4,
      hslMagentaHue: 0, hslMagentaSat: -10, hslMagentaLum: -6,
      lensDistortion: 0, lensChromaticAberration: 8, lensVignette: -10,
    },
  },

  // ---------------------------------------------------------------------------
  // B&W Crisp — full desaturation, strong S-curve, B&W luminance mixing recipe
  // ---------------------------------------------------------------------------
  {
    id: "bw-crisp",
    name: "B&W Crisp",
    settings: {
      exposure: 3, contrast: 30, highlights: -14, shadows: 10,
      whites: 16, blacks: -20, temperature: 0, tint: 0,
      vibrance: -100, saturation: -100,
      texture: 22, clarity: 20, dehaze: 8, vignette: -18, grain: 20,
      sharpness: 32, sharpenMasking: 45, noiseReduction: 8, colorNoiseReduction: 10,
      curveShadows: -14, curveDarks: -8, curveLights: 10, curveHighlights: 8,
      gradeShadowsHue: 214, gradeShadowsSat: 10,
      gradeMidHue: 210, gradeMidSat: 6,
      gradeHighHue: 48, gradeHighSat: 4, gradeBalance: -8,
      hslRedHue: 0, hslRedSat: 0, hslRedLum: 20,
      hslOrangeHue: 0, hslOrangeSat: 0, hslOrangeLum: 16,
      hslYellowHue: 0, hslYellowSat: 0, hslYellowLum: 10,
      hslGreenHue: 0, hslGreenSat: 0, hslGreenLum: -14,
      hslAquaHue: 0, hslAquaSat: 0, hslAquaLum: -10,
      hslBlueHue: 0, hslBlueSat: 0, hslBlueLum: -22,
      hslPurpleHue: 0, hslPurpleSat: 0, hslPurpleLum: -8,
      hslMagentaHue: 0, hslMagentaSat: 0, hslMagentaLum: 6,
      lensDistortion: 0, lensChromaticAberration: 0, lensVignette: -8,
    },
  },
];

const controls = [
  // Basic
  { group: "basic", key: "exposure", label: "Exposure", min: -50, max: 50, step: 1, fmt: (v) => `${(v / 10).toFixed(1)} EV`, def: 0 },
  { group: "basic", key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "basic", key: "highlights", label: "Highlights", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "basic", key: "shadows", label: "Shadows", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "basic", key: "whites", label: "Whites", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "basic", key: "blacks", label: "Blacks", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "basic", key: "temperature", label: "Temp", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "basic", key: "tint", label: "Tint", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "basic", key: "vibrance", label: "Vibrance", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "basic", key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  // HSL / Color
  { group: "color", key: "hslRedHue", label: "Red Hue", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslRedSat", label: "Red Sat", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslRedLum", label: "Red Lum", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslOrangeHue", label: "Orange Hue", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslOrangeSat", label: "Orange Sat", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslOrangeLum", label: "Orange Lum", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslYellowHue", label: "Yellow Hue", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslYellowSat", label: "Yellow Sat", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslYellowLum", label: "Yellow Lum", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslGreenHue", label: "Green Hue", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslGreenSat", label: "Green Sat", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslGreenLum", label: "Green Lum", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslAquaHue", label: "Aqua Hue", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslAquaSat", label: "Aqua Sat", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslAquaLum", label: "Aqua Lum", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslBlueHue", label: "Blue Hue", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslBlueSat", label: "Blue Sat", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslBlueLum", label: "Blue Lum", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslPurpleHue", label: "Purple Hue", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslPurpleSat", label: "Purple Sat", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslPurpleLum", label: "Purple Lum", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslMagentaHue", label: "Magenta Hue", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslMagentaSat", label: "Magenta Sat", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "color", key: "hslMagentaLum", label: "Magenta Lum", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  // Tone curve
  { group: "curve", key: "curveShadows", label: "Shadows", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "curve", key: "curveDarks", label: "Darks", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "curve", key: "curveLights", label: "Lights", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "curve", key: "curveHighlights", label: "Highlights", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  // Color grading
  { group: "grading", key: "gradeShadowsHue", label: "Shadows Hue", min: 0, max: 360, step: 1, fmt: (v) => `${v}°`, def: 220 },
  { group: "grading", key: "gradeShadowsSat", label: "Shadows Sat", min: 0, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "grading", key: "gradeMidHue", label: "Mid Hue", min: 0, max: 360, step: 1, fmt: (v) => `${v}°`, def: 40 },
  { group: "grading", key: "gradeMidSat", label: "Mid Sat", min: 0, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "grading", key: "gradeHighHue", label: "Highlights Hue", min: 0, max: 360, step: 1, fmt: (v) => `${v}°`, def: 50 },
  { group: "grading", key: "gradeHighSat", label: "Highlights Sat", min: 0, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "grading", key: "gradeBalance", label: "Balance", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  // Crop
  { group: "crop", key: "cropLeft", label: "Left", min: 0, max: 45, step: 0.1, fmt: (v) => `${Number(v).toFixed(1)}%`, def: 0 },
  { group: "crop", key: "cropTop", label: "Top", min: 0, max: 45, step: 0.1, fmt: (v) => `${Number(v).toFixed(1)}%`, def: 0 },
  { group: "crop", key: "cropRight", label: "Right", min: 0, max: 45, step: 0.1, fmt: (v) => `${Number(v).toFixed(1)}%`, def: 0 },
  { group: "crop", key: "cropBottom", label: "Bottom", min: 0, max: 45, step: 0.1, fmt: (v) => `${Number(v).toFixed(1)}%`, def: 0 },
  // Lens corrections
  { group: "lens", key: "lensDistortion", label: "Distortion", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "lens", key: "lensChromaticAberration", label: "Chromatic Aberration", min: 0, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "lens", key: "lensVignette", label: "Vignette (Lens)", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  // Detail
  { group: "detail", key: "sharpness", label: "Sharpen", min: 0, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "detail", key: "sharpenMasking", label: "Masking", min: 0, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "detail", key: "noiseReduction", label: "Denoise (L)", min: 0, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "detail", key: "colorNoiseReduction", label: "Denoise (C)", min: 0, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  // Effects
  { group: "effects", key: "texture", label: "Texture", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "effects", key: "clarity", label: "Clarity", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "effects", key: "dehaze", label: "Dehaze", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "effects", key: "vignette", label: "Vignette", min: -100, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  { group: "effects", key: "grain", label: "Grain", min: 0, max: 100, step: 1, fmt: (v) => `${v}`, def: 0 },
  // Transform
  { group: "transform", key: "rotate", label: "Rotate", min: -45, max: 45, step: 0.1, fmt: (v) => `${Number(v).toFixed(1)}°`, def: 0 },
  { group: "transform", key: "flipH", label: "Flip H", min: 0, max: 1, step: 1, fmt: (v) => (Number(v) ? "On" : "Off"), def: 0, toggle: true },
  { group: "transform", key: "flipV", label: "Flip V", min: 0, max: 1, step: 1, fmt: (v) => (Number(v) ? "On" : "Off"), def: 0, toggle: true },
];

const SETTINGS_DEFAULTS = Object.fromEntries(controls.map((c) => [c.key, c.def]));

function setStatus(text) { statusEl.textContent = text; }

function makeControl(def) {
  const wrap = document.createElement("div");
  wrap.className = "control";
  const row = document.createElement("div");
  row.className = "control__row";
  const label = document.createElement("div");
  label.className = "control__label";
  label.textContent = def.label;
  const value = document.createElement("div");
  value.className = "control__value";
  value.textContent = def.fmt(state.settings[def.key]);
  row.append(label, value);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = String(def.step);
  input.value = String(state.settings[def.key]);
  input.disabled = true;
  const setVal = (v) => {
    const vv = def.toggle ? (v ? 1 : 0) : Number(v);
    state.settings[def.key] = vv;
    input.value = String(vv);
    value.textContent = def.fmt(vv);
  };
  input.addEventListener("input", () => { setVal(input.value); scheduleRender(); });
  input.addEventListener("dblclick", () => { setVal(def.def); scheduleRender(); });
  wrap.append(row, input);
  return { wrap, input, setVal, value };
}

const controlEls = new Map();
for (const def of controls) {
  const { wrap, input, setVal } = makeControl(def);
  controlEls.set(def.key, { input, setVal, def });
  if (def.group === "basic") basicControls.append(wrap);
  else if (def.group === "color") colorControls.append(wrap);
  else if (def.group === "curve") curveControls.append(wrap);
  else if (def.group === "grading") gradingControls.append(wrap);
  else if (def.group === "crop") cropControls.append(wrap);
  else if (def.group === "lens") lensControls.append(wrap);
  else if (def.group === "detail") detailControls.append(wrap);
  else if (def.group === "effects") effectsControls.append(wrap);
  else transformControls.append(wrap);
}

function enableEditing(on) {
  for (const { input } of controlEls.values()) input.disabled = !on;
  resetBtn.disabled = !on; compareBtn.disabled = !on; downloadBtn.disabled = !on;
  exportFormat.disabled = !on; exportQuality.disabled = !on; zoomEl.disabled = !on;
  fitBtn.disabled = !on; actualBtn.disabled = !on; presetSelect.disabled = !on;
  applyPresetBtn.disabled = !on; importPresetBtn.disabled = !on;
  presetFileInput.disabled = !on; exportPresetBtn.disabled = !on;
}

function resetAll() {
  for (const [key, { setVal, def }] of controlEls.entries()) setVal(def.def);
  presetSelect.value = "none";
  scheduleRender();
}

function applyPresetById(id) {
  const preset = PRESETS.find((p) => p.id === id) || PRESETS[0];
  for (const [key, value] of Object.entries(preset.settings || {})) {
    const el = controlEls.get(key);
    if (el) el.setVal(value);
  }
  scheduleRender();
  setStatus(`Preset applied: ${preset.name}.`);
}

async function exportCurrentPreset() {
  if (!state.loaded) return;
  const fullSettings = {};
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    fullSettings[key] = key in state.settings ? state.settings[key] : SETTINGS_DEFAULTS[key];
  }
  const payload = {
    type: "mini-lightroom-preset", version: 2,
    exportedAt: new Date().toISOString(),
    name: `${state.imageName || "Preset"} (exported)`,
    settings: fullSettings,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${state.imageName || "image"}-preset.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  setStatus("Preset exported (JSON) — all attributes included.");
}

function normalizePresetPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload.settings && typeof payload.settings === "object" ? payload.settings : payload;
  if (!raw || typeof raw !== "object") return null;
  const normalized = { ...SETTINGS_DEFAULTS };
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in SETTINGS_DEFAULTS)) continue;
    const num = Number(value);
    if (!Number.isFinite(num)) continue;
    normalized[key] = num;
  }
  return {
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : "Imported preset",
    settings: normalized,
  };
}

async function importPresetFromFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const normalized = normalizePresetPayload(payload);
    if (!normalized) { setStatus("Invalid preset JSON (missing or unrecognised settings)."); return; }
    for (const [key, { setVal, def }] of controlEls.entries()) {
      setVal(key in normalized.settings ? normalized.settings[key] : def.def);
    }
    const id = `import-${Date.now().toString(36)}`;
    PRESETS.push({ id, name: normalized.name, settings: normalized.settings });
    const opt = document.createElement("option");
    opt.value = id; opt.textContent = normalized.name;
    presetSelect.appendChild(opt);
    presetSelect.value = id;
    scheduleRender();
    setStatus(`Preset imported: "${normalized.name}" — all attributes applied.`);
  } catch (e) { setStatus("Failed to import preset JSON."); }
}

function luminance255(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

const HSL_KEYS = [
  "hslRedHue","hslRedSat","hslRedLum",
  "hslOrangeHue","hslOrangeSat","hslOrangeLum",
  "hslYellowHue","hslYellowSat","hslYellowLum",
  "hslGreenHue","hslGreenSat","hslGreenLum",
  "hslAquaHue","hslAquaSat","hslAquaLum",
  "hslBlueHue","hslBlueSat","hslBlueLum",
  "hslPurpleHue","hslPurpleSat","hslPurpleLum",
  "hslMagentaHue","hslMagentaSat","hslMagentaLum",
];

function applyAdjustments(base, out, w, h, s) {
  const exposure = Math.pow(2, (s.exposure || 0) / 10);
  const contrast = Number(s.contrast || 0);
  const contrastC = (contrast / 100) * 128;
  const contrastFactor = (259 * (contrastC + 255)) / (255 * (259 - contrastC));
  const highlights = (Number(s.highlights || 0) / 100) * 0.9;
  const shadows = (Number(s.shadows || 0) / 100) * 0.9;
  const whites = (Number(s.whites || 0) / 100) * 0.6;
  const blacks = (Number(s.blacks || 0) / 100) * 0.6;
  const texture = Number(s.texture || 0) / 100;
  const clarity = (Number(s.clarity || 0) / 100) * 0.5;
  const dehaze = Number(s.dehaze || 0) / 100;
  const vibrance = Number(s.vibrance || 0) / 100;
  const saturation = 1 + Number(s.saturation || 0) / 100;
  const sharpness = Number(s.sharpness || 0);
  const sharpenMasking = Number(s.sharpenMasking || 0) / 100;
  const noiseReduction = Number(s.noiseReduction || 0) / 100;
  const colorNoiseReduction = Number(s.colorNoiseReduction || 0) / 100;
  const grain = Number(s.grain || 0);
  const lensVignette = Number(s.lensVignette || 0) / 100;
  const hasHsl = HSL_KEYS.some((k) => Number(s[k] || 0) !== 0);
  const hasCurve = Number(s.curveShadows||0)||Number(s.curveDarks||0)||Number(s.curveLights||0)||Number(s.curveHighlights||0);
  const curveLut = hasCurve ? buildToneCurveLut(s) : null;
  const gsHue = Number(s.gradeShadowsHue || 0);
  const gsSat = clamp01(Number(s.gradeShadowsSat || 0) / 100);
  const gmHue = Number(s.gradeMidHue || 0);
  const gmSat = clamp01(Number(s.gradeMidSat || 0) / 100);
  const ghHue = Number(s.gradeHighHue || 0);
  const ghSat = clamp01(Number(s.gradeHighSat || 0) / 100);
  const gBalance = clamp01((Number(s.gradeBalance || 0) + 100) / 200);
  const hasGrading = gsSat > 0.0001 || gmSat > 0.0001 || ghSat > 0.0001;
  const [gsr, gsg, gsb] = hueSatToRgb01(gsHue, gsSat);
  const [gmr, gmg, gmb] = hueSatToRgb01(gmHue, gmSat);
  const [ghr, ghg, ghb] = hueSatToRgb01(ghHue, ghSat);
  const temp = Number(s.temperature || 0);
  const tint = Number(s.tint || 0);
  const tempK = temp * 0.0022;
  const tintK = tint * 0.0022;
  const vignette = Number(s.vignette || 0) / 100;
  const vignetteStrength = Math.abs(vignette) * 0.9;
  const vignetteSign = vignette < 0 ? -1 : 1;
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const invCx = cx ? 1 / cx : 0, invCy = cy ? 1 / cy : 0;
  const hasVignette = vignetteStrength > 0.0001;
  const hasColorTemp = Math.abs(temp) + Math.abs(tint) > 0.1;

  for (let i = 0; i < base.length; i += 4) {
    let r = base[i], g = base[i+1], b = base[i+2];
    const a = base[i+3];
    if (exposure !== 1) { r *= exposure; g *= exposure; b *= exposure; }
    if (hasColorTemp) {
      r *= 1 + tempK + tintK * 0.4;
      g *= 1 - tintK;
      b *= 1 - tempK + tintK * 0.4;
    }
    if (contrast !== 0) {
      r = contrastFactor * (r - 128) + 128;
      g = contrastFactor * (g - 128) + 128;
      b = contrastFactor * (b - 128) + 128;
    }
    const y = luminance255(r, g, b) / 255;
    let y2 = y;
    if (shadows !== 0 && y < 0.5) { const t = (0.5-y)/0.5; y2 = clamp01(y2 + shadows*t*(0.6+0.4*(1-t))); }
    if (highlights !== 0 && y > 0.5) { const t = (y-0.5)/0.5; y2 = clamp01(y2 + highlights*(1-t)*t*0.9); }
    if (blacks !== 0 && y < 0.6) { const t = 1-y/0.6; y2 = clamp01(y2 + blacks*t*0.35); }
    if (whites !== 0 && y > 0.4) { const t = (y-0.4)/0.6; y2 = clamp01(y2 + whites*t*0.35); }
    if (clarity !== 0) { const m = 1-Math.abs(2*y2-1); y2 = clamp01(y2 + clarity*(y2-0.5)*m); }
    if (dehaze !== 0) { const m = 1-Math.abs(2*y2-1); y2 = clamp01(y2 + dehaze*0.22*(y2-0.5)*(0.7+0.3*m)); }
    const ratio = (y*255) > 0.0001 ? (y2*255)/(y*255) : 1;
    r *= ratio; g *= ratio; b *= ratio;
    if (vibrance !== 0 || saturation !== 1 || dehaze !== 0) {
      const yy = luminance255(r, g, b);
      const satNow = (Math.max(r,g,b) - Math.min(r,g,b)) / 255;
      const sf = saturation * (1 + vibrance*(1-satNow)) * (1 + dehaze*0.12);
      r = yy+(r-yy)*sf; g = yy+(g-yy)*sf; b = yy+(b-yy)*sf;
    }
    if (hasHsl) {
      let [hue, sat, lum] = rgbToHsl255(r, g, b);
      const centers = [0,30,60,120,180,220,270,300];
      const keys = [
        ["hslRedHue","hslRedSat","hslRedLum"],["hslOrangeHue","hslOrangeSat","hslOrangeLum"],
        ["hslYellowHue","hslYellowSat","hslYellowLum"],["hslGreenHue","hslGreenSat","hslGreenLum"],
        ["hslAquaHue","hslAquaSat","hslAquaLum"],["hslBlueHue","hslBlueSat","hslBlueLum"],
        ["hslPurpleHue","hslPurpleSat","hslPurpleLum"],["hslMagentaHue","hslMagentaSat","hslMagentaLum"],
      ];
      let hs=0, sm=1, ls=0;
      for (let c=0; c<centers.length; c++) {
        const w = clamp01(1 - hueDistDeg(hue, centers[c])/45);
        if (w<=0) continue;
        const [kh,ks,kl] = keys[c];
        hs += Number(s[kh]||0)*0.6*w;
        sm *= 1 + (Number(s[ks]||0)/100)*w;
        ls += (Number(s[kl]||0)/100)*0.35*w;
      }
      hue = mod360(hue+hs); sat = clamp01(sat*sm); lum = clamp01(lum+ls);
      [r,g,b] = hslToRgb255(hue, sat, lum);
    }
    if (curveLut) { r=curveLut[clamp255(r)|0]; g=curveLut[clamp255(g)|0]; b=curveLut[clamp255(b)|0]; }
    if (hasGrading) {
      const y = luminance255(r, g, b) / 255;
      const shW = (1 - smoothstep(0.25+0.25*gBalance, 0.6+0.2*gBalance, y))*0.95;
      const hiW = smoothstep(0.4-0.2*(1-gBalance), 0.8-0.1*(1-gBalance), y)*0.95;
      const midW = clamp01(1-Math.abs(y-0.5)/0.35)*0.7;
      const sa=shW*gsSat*0.45, ma=midW*gmSat*0.35, ha=hiW*ghSat*0.45;
      const keep = 1-clamp01(sa+ma+ha);
      r = r*keep+255*(gsr*sa+gmr*ma+ghr*ha);
      g = g*keep+255*(gsg*sa+gmg*ma+ghg*ha);
      b = b*keep+255*(gsb*sa+gmb*ma+ghb*ha);
    }
    out[i]=clamp255(r); out[i+1]=clamp255(g); out[i+2]=clamp255(b); out[i+3]=a;
  }

  // pass 2: noise reduction
  const nrL=clamp01(noiseReduction), nrC=clamp01(colorNoiseReduction);
  if (nrL>0||nrC>0) {
    const tmp=new Uint8ClampedArray(out);
    for (let yy=1; yy<h-1; yy++) for (let xx=1; xx<w-1; xx++) {
      const idx=(yy*w+xx)*4;
      let sR=0,sG=0,sB=0;
      for (let oy=-1;oy<=1;oy++) for (let ox=-1;ox<=1;ox++) { const j=((yy+oy)*w+(xx+ox))*4; sR+=tmp[j];sG+=tmp[j+1];sB+=tmp[j+2]; }
      const bR=sR/9,bG=sG/9,bB=sB/9;
      let r=tmp[idx],g=tmp[idx+1],b=tmp[idx+2];
      if (nrL>0) { r=r*(1-nrL)+bR*nrL; g=g*(1-nrL)+bG*nrL; b=b*(1-nrL)+bB*nrL; }
      if (nrC>0) { const rat=(luminance255(r,g,b)||1e-9)/(luminance255(bR,bG,bB)||1); r=r*(1-nrC)+bR*rat*nrC; g=g*(1-nrC)+bG*rat*nrC; b=b*(1-nrC)+bB*rat*nrC; }
      out[idx]=clamp255(r); out[idx+1]=clamp255(g); out[idx+2]=clamp255(b);
    }
  }

  // pass 3: texture/sharpen/dehaze
  if (texture!==0||dehaze!==0||sharpness>0) {
    const tex=texture*0.9, deh=dehaze*1.1, shp=(sharpness/100)*1.35, mask=clamp01(sharpenMasking);
    const tmp=new Uint8ClampedArray(out);
    for (let yy=1; yy<h-1; yy++) for (let xx=1; xx<w-1; xx++) {
      const idx=(yy*w+xx)*4;
      let sR=0,sG=0,sB=0;
      for (let oy=-1;oy<=1;oy++) for (let ox=-1;ox<=1;ox++) { const j=((yy+oy)*w+(xx+ox))*4; sR+=tmp[j];sG+=tmp[j+1];sB+=tmp[j+2]; }
      const bR=sR/9,bG=sG/9,bB=sB/9;
      const r0=tmp[idx],g0=tmp[idx+1],b0=tmp[idx+2];
      const dr=r0-bR,dg=g0-bG,db=b0-bB;
      const y0=luminance255(r0,g0,b0)/255;
      const mid=1-Math.abs(2*y0-1);
      const edge=clamp01((Math.abs(dr)+Math.abs(dg)+Math.abs(db))/(3*64));
      const maskW=mask<=0?1:clamp01((edge-mask*0.35)/(1-mask*0.35));
      const wAll=tex*(0.35+0.65*mid)+deh*(0.6+0.4*(1-y0))+shp*maskW;
      out[idx]=clamp255(r0+wAll*dr); out[idx+1]=clamp255(g0+wAll*dg); out[idx+2]=clamp255(b0+wAll*db);
    }
  }

  // pass 4: grain
  if (grain>0) {
    const gAmt=clamp01(grain/100)*22, seed=(performance.now()*1000)|0;
    for (let i=0; i<out.length; i+=4) {
      const r0=out[i],g0=out[i+1],b0=out[i+2];
      let x=((i/4)|0)^seed; x^=x<<13; x^=x>>>17; x^=x<<5;
      const d=((x>>>0)/4294967295-0.5)*2*gAmt*(0.55+0.45*(1-luminance255(r0,g0,b0)/255));
      out[i]=clamp255(r0+d); out[i+1]=clamp255(g0+d); out[i+2]=clamp255(b0+d);
    }
  }

  // pass 5: vignette
  if (hasVignette||Math.abs(lensVignette)>0.0001) {
    const ls=Math.abs(lensVignette)*0.75, lsign=lensVignette<0?-1:1;
    for (let y=0;y<h;y++) { const dy=(y-cy)*invCy;
      for (let x=0;x<w;x++) { const dx=(x-cx)*invCx;
        const t=clamp01((Math.sqrt(dx*dx+dy*dy)-0.25)/0.85);
        let f=1;
        if (hasVignette) { const v=vignetteStrength*t*t; f*=vignetteSign<0?1-v:1+v*0.75; }
        if (ls>0) { const v=ls*t*t; f*=lsign<0?1-v:1+v*0.55; }
        const idx=(y*w+x)*4;
        out[idx]=clamp255(out[idx]*f); out[idx+1]=clamp255(out[idx+1]*f); out[idx+2]=clamp255(out[idx+2]*f);
      }
    }
  }
}

function ensureCanvasSizes(w, h) {
  if (bufferCanvas.width!==w||bufferCanvas.height!==h) { bufferCanvas.width=w; bufferCanvas.height=h; }
  const pxW=Math.floor(w*dpr), pxH=Math.floor(h*dpr);
  if (viewCanvas.width!==pxW||viewCanvas.height!==pxH) { viewCanvas.width=pxW; viewCanvas.height=pxH; }
  if (lastViewW!==w||lastViewH!==h||lastZoom!==state.zoom) {
    viewCanvas.style.width=`${w*state.zoom}px`; viewCanvas.style.height=`${h*state.zoom}px`;
    lastViewW=w; lastViewH=h; lastZoom=state.zoom;
  }
}

function computeCropRectPx(w, h, s) {
  const left=clamp01(Number(s.cropLeft||0)/100), top=clamp01(Number(s.cropTop||0)/100);
  const right=clamp01(Number(s.cropRight||0)/100), bottom=clamp01(Number(s.cropBottom||0)/100);
  const x0=Math.round(left*w), y0=Math.round(top*h);
  const x1=Math.round((1-right)*w), y1=Math.round((1-bottom)*h);
  return { x:Math.min(w-1,Math.max(0,x0)), y:Math.min(h-1,Math.max(0,y0)), w:Math.max(1,x1-x0), h:Math.max(1,y1-y0) };
}

function ensureCropBuffers() {
  if (!state.loaded) return;
  const rect=computeCropRectPx(state.fullW, state.fullH, state.settings);
  if (rect.w===state.w&&rect.h===state.h) return;
  state.w=rect.w; state.h=rect.h;
  state.outImageData=new ImageData(new Uint8ClampedArray(state.w*state.h*4), state.w, state.h);
  fitToStage();
}

function drawToViewCanvas(imageData, w, h, settings) {
  if (!viewCtx) return;
  ensureCanvasSizes(w, h);
  viewCtx.setTransform(dpr,0,0,dpr,0,0);
  viewCtx.clearRect(0,0,w,h);
  bufferCtx.putImageData(imageData,0,0);
  const angle=(Number(settings.rotate||0)*Math.PI)/180;
  const flipX=Number(settings.flipH||0)?-1:1, flipY=Number(settings.flipV||0)?-1:1;
  viewCtx.save();
  viewCtx.translate(w/2,h/2); viewCtx.rotate(angle); viewCtx.scale(flipX,flipY); viewCtx.translate(-w/2,-h/2);
  viewCtx.drawImage(bufferCanvas,0,0);
  viewCtx.restore();
}

function sampleRGBAClamp(src,w,h,x,y,out,o) {
  const xx=x<0?0:x>=w?w-1:x, yy=y<0?0:y>=h?h-1:y, idx=(yy*w+xx)*4;
  out[o]=src[idx]; out[o+1]=src[idx+1]; out[o+2]=src[idx+2]; out[o+3]=src[idx+3];
}

function applyLensWarpInPlace(data,w,h,s) {
  const distortion=Number(s.lensDistortion||0), ca=Number(s.lensChromaticAberration||0);
  if (distortion===0&&ca===0) return;
  const k1=(distortion/100)*0.35, caK=(ca/100)*0.015;
  const cx=(w-1)/2, cy=(h-1)/2;
  const invCx=cx?1/cx:0, invCy=cy?1/cy:0;
  const src=new Uint8ClampedArray(data), tmp=new Uint8ClampedArray(4);
  for (let y=0;y<h;y++) { const dyN=(y-cy)*invCy;
    for (let x=0;x<w;x++) {
      const dxN=(x-cx)*invCx, r2=dxN*dxN+dyN*dyN, scale=1+k1*r2;
      const sx=cx+(x-cx)*scale, sy=cy+(y-cy)*scale, idx=(y*w+x)*4;
      if (ca===0) { sampleRGBAClamp(src,w,h,sx|0,sy|0,data,idx); continue; }
      const rS=1+caK*r2, bS=1-caK*r2;
      sampleRGBAClamp(src,w,h,sx|0,sy|0,tmp,0); const g=tmp[1],a=tmp[3];
      sampleRGBAClamp(src,w,h,(cx+(sx-cx)*rS)|0,(cy+(sy-cy)*rS)|0,tmp,0); const r=tmp[0];
      sampleRGBAClamp(src,w,h,(cx+(sx-cx)*bS)|0,(cy+(sy-cy)*bS)|0,tmp,0); const b=tmp[2];
      data[idx]=r; data[idx+1]=g; data[idx+2]=b; data[idx+3]=a;
    }
  }
}

let renderQueued=false;
function scheduleRender() {
  if (!state.loaded||renderQueued) return;
  renderQueued=true;
  requestAnimationFrame(()=>{ renderQueued=false; renderPreview(); });
}

function renderPreview() {
  if (!state.loaded) return;
  ensureCropBuffers();
  const crop=computeCropRectPx(state.fullW,state.fullH,state.settings);
  const w=state.w, h=state.h, out=state.outImageData.data;
  const base=new Uint8ClampedArray(w*h*4);
  for (let yy=0;yy<h;yy++) {
    const ss=((crop.y+yy)*state.fullW+crop.x)*4;
    base.set(state.base.subarray(ss,ss+w*4),yy*w*4);
  }
  if (state.compare) { drawToViewCanvas(new ImageData(new Uint8ClampedArray(base),w,h),w,h,state.settings); return; }
  applyAdjustments(base,out,w,h,state.settings);
  applyLensWarpInPlace(out,w,h,state.settings);
  drawToViewCanvas(state.outImageData,w,h,state.settings);
}

function fitToStage() {
  if (!state.loaded) return;
  const b=stageInner.getBoundingClientRect(), pad=32;
  state.fitZoom=Math.min(Math.max(10,b.width-pad)/state.w, Math.max(10,b.height-pad)/state.h);
  setZoom(state.fitZoom);
}

function setZoom(z) {
  state.zoom=Math.max(0.25,Math.min(4,z));
  zoomEl.value=String(Math.round(state.zoom*100));
  zoomValue.textContent=`${Math.round(state.zoom*100)}%`;
  scheduleRender();
}

const resizeObserver=new ResizeObserver(()=>{ if (state.loaded) fitToStage(); });
resizeObserver.observe(stageInner);

async function loadImageFromFile(file) {
  if (!file) return;
  setStatus("Loading image…");
  const buf=await file.arrayBuffer();
  let bitmap=null;
  if (isHeicFile(file)) {
    try {
      setStatus("Converting HEIC…");
      const h2a=await ensureHeic2any();
      if (typeof h2a!=="function") throw new Error("heic2any not available");
      bitmap=await createImageBitmap(await h2a({blob:new Blob([buf],{type:file.type||"image/heic"}),toType:"image/jpeg",quality:0.95}));
    } catch { setStatus("HEIC import failed. Try converting to JPG/PNG first."); return; }
  } else if (isRawFile(file)) {
    try { setStatus("Decoding RAW…"); bitmap=await decodeRawToBitmap(file,buf); }
    catch { setStatus("RAW import failed in this browser. Try converting to DNG/JPG first."); return; }
  } else {
    bitmap=await createImageBitmap(new Blob([buf],{type:file.type||"image/*"}));
  }
  state.imageBitmap=bitmap;
  state.imageName=(file.name||"image").replace(/\.[a-z0-9]+$/i,"");
  state.loaded=true; placeholder.style.display="none";
  const scale=Math.min(1,state.workMaxDim/Math.max(bitmap.width,bitmap.height));
  const w=Math.max(1,Math.round(bitmap.width*scale)), h=Math.max(1,Math.round(bitmap.height*scale));
  state.fullW=w; state.fullH=h; state.w=w; state.h=h;
  const wc=document.createElement("canvas"); wc.width=w; wc.height=h;
  const wctx=wc.getContext("2d",{willReadFrequently:true});
  wctx.imageSmoothingEnabled=true; wctx.imageSmoothingQuality="high";
  wctx.drawImage(bitmap,0,0,w,h);
  const img=wctx.getImageData(0,0,w,h);
  state.base=new Uint8ClampedArray(img.data);
  state.outImageData=new ImageData(new Uint8ClampedArray(w*h*4),w,h);
  enableEditing(true); resetAll(); fitToStage();
  setStatus(`Loaded ${bitmap.width}×${bitmap.height} (preview ${w}×${h}).`);
}

function setCompare(on) {
  state.compare=on;
  compareBtn.classList.toggle("btn--primary",on);
  compareBtn.classList.toggle("btn--ghost",!on);
  scheduleRender();
}

async function exportImage() {
  if (!state.loaded||!state.imageBitmap) return;
  const fmt=exportFormat.value, useFull=exportQuality.value==="full", src=state.imageBitmap;
  let scale=1;
  if (useFull) { const ms=Math.max(src.width,src.height); if (ms>state.exportMaxDim) scale=state.exportMaxDim/ms; }
  else scale=Math.min(1,state.workMaxDim/Math.max(src.width,src.height));
  const w=Math.max(1,Math.round(src.width*scale)), h=Math.max(1,Math.round(src.height*scale));
  const crop=computeCropRectPx(w,h,state.settings);
  setStatus(`Exporting ${crop.w}×${crop.h}…`);
  const bc=document.createElement("canvas"); bc.width=w; bc.height=h;
  const bctx=bc.getContext("2d",{willReadFrequently:true});
  bctx.imageSmoothingEnabled=true; bctx.imageSmoothingQuality="high"; bctx.drawImage(src,0,0,w,h);
  const img=bctx.getImageData(crop.x,crop.y,crop.w,crop.h);
  const base=new Uint8ClampedArray(img.data), outData=new Uint8ClampedArray(img.data.length);
  applyAdjustments(base,outData,crop.w,crop.h,state.settings);
  applyLensWarpInPlace(outData,crop.w,crop.h,state.settings);
  const view=document.createElement("canvas"); view.width=crop.w; view.height=crop.h;
  const vctx=view.getContext("2d");
  const tmp=document.createElement("canvas"); tmp.width=crop.w; tmp.height=crop.h;
  tmp.getContext("2d").putImageData(new ImageData(outData,crop.w,crop.h),0,0);
  const angle=(Number(state.settings.rotate||0)*Math.PI)/180;
  const flipX=Number(state.settings.flipH||0)?-1:1, flipY=Number(state.settings.flipV||0)?-1:1;
  vctx.setTransform(1,0,0,1,0,0); vctx.clearRect(0,0,crop.w,crop.h);
  if (fmt==="image/jpeg") { vctx.fillStyle="#ffffff"; vctx.fillRect(0,0,crop.w,crop.h); }
  vctx.translate(crop.w/2,crop.h/2); vctx.rotate(angle); vctx.scale(flipX,flipY);
  vctx.translate(-crop.w/2,-crop.h/2); vctx.drawImage(tmp,0,0);
  const quality=fmt==="image/jpeg"?0.92:undefined;
  let blob=await new Promise(resolve=>view.toBlob(resolve,fmt,quality));
  if (!blob) { setStatus("Export failed."); return; }
  const ext=fmt==="image/jpeg"?"jpg":fmt==="image/png"?"png":"webp";
  const filename=`${state.imageName}-edit.${ext}`;
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  const cap=useFull&&Math.max(src.width,src.height)>state.exportMaxDim?` (capped to ${state.exportMaxDim}px)`:"";
  setStatus(`Downloaded ${filename}${cap}.`);
}

// Event listeners
stageInner.addEventListener("dragover",(e)=>{e.preventDefault();stageInner.classList.add("drag");});
stageInner.addEventListener("dragleave",()=>stageInner.classList.remove("drag"));
stageInner.addEventListener("drop",async(e)=>{e.preventDefault();stageInner.classList.remove("drag");const f=e.dataTransfer?.files?.[0];if(f)await loadImageFromFile(f);});
fileInput.addEventListener("change",async()=>{const f=fileInput.files?.[0];fileInput.value="";if(f)await loadImageFromFile(f);});
resetBtn.addEventListener("click",()=>resetAll());
compareBtn.addEventListener("mousedown",()=>setCompare(true));
compareBtn.addEventListener("mouseup",()=>setCompare(false));
compareBtn.addEventListener("mouseleave",()=>setCompare(false));
compareBtn.addEventListener("touchstart",()=>setCompare(true),{passive:true});
compareBtn.addEventListener("touchend",()=>setCompare(false),{passive:true});
window.addEventListener("keydown",(e)=>{if(!state.loaded)return;if(e.key==="\\")setCompare(true);});
window.addEventListener("keyup",(e)=>{if(!state.loaded)return;if(e.key==="\\")setCompare(false);});
downloadBtn.addEventListener("click",()=>exportImage());
zoomEl.addEventListener("input",()=>setZoom(Number(zoomEl.value)/100));
fitBtn.addEventListener("click",()=>fitToStage());
actualBtn.addEventListener("click",()=>setZoom(1));

for (const p of PRESETS) {
  const opt=document.createElement("option");
  opt.value=p.id; opt.textContent=p.name;
  presetSelect.appendChild(opt);
}
presetSelect.value="none";
applyPresetBtn.addEventListener("click",()=>applyPresetById(presetSelect.value));
exportPresetBtn.addEventListener("click",()=>exportCurrentPreset());
importPresetBtn.addEventListener("click",()=>presetFileInput.click());
presetFileInput.addEventListener("change",async()=>{const f=presetFileInput.files?.[0];presetFileInput.value="";if(f)await importPresetFromFile(f);});

enableEditing(false);
setZoom(1);
