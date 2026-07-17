"use strict";

document.documentElement.classList.toggle("is-tauri", Boolean(window.__TAURI__));

const $ = (id) => document.getElementById(id);

let PRESETS = [];
let presetThumbnailObserver = null;
const thumbnailPresets = new WeakMap();

const GRAIN_TRAIT_KEYS = ["medium", "crystal", "emulsion", "scale", "process"];
const STOCK_GRAIN_TRAITS = Object.freeze(Object.fromEntries(GRAIN_TRAIT_KEYS.map((key) => [key, "stock"])));
const GRAIN_TRAITS = {
    medium: { label: "Image", options: [["stock", "Stock match"], ["silver", "Silver"], ["dye", "Dye clouds"]] },
    crystal: { label: "Crystal", options: [["stock", "Stock match"], ["cubic", "Cubic"], ["tabular", "T-Grain"], ["delta", "Delta"]] },
    emulsion: { label: "Emulsion", options: [["stock", "Stock match"], ["uniform", "Uniform"], ["mixed", "Mixed sizes"], ["core-shell", "Core-shell"]] },
    scale: { label: "Scale", options: [["stock", "Stock match"], ["fine", "Fine"], ["medium", "Medium"], ["coarse", "Coarse"]] },
    process: {
        label: "Lab",
        options: [
            ["stock", "Stock match"],
            ["standard", "Standard"],
            ["push", "Push +2"],
            ["pull", "Pull −1"],
            ["motion", "Motion ECN-2"],
            ["bleach", "Silver retention"],
            ["cross", "Cross process"],
        ],
    },
};

const DEFAULT_PIPELINE = Object.freeze({
    version: 1,
    family: "utility",
    monochrome: false,
    scene: { sensitivity: [1, 1, 1], flash: 0 },
    curve: { toe: 0, shoulder: 0, gamma: 1, saturationCompression: 0 },
    crossover: { shadows: [0, 0, 0], highlights: [0, 0, 0] },
    chemistry: { silverRetention: 0, fog: 0, flare: 0, localContrast: 0 },
    optics: { halation: 0, halationRadius: 0, halationThreshold: 1 },
    output: { tint: [1, 1, 1], scanContrast: 1 },
    grain: { meanRadius: 0.6, radiusVariance: 0.1, shadowBias: 0.1, chroma: 0.03 },
});
const LOCAL_DENSITY_OFFSETS = Object.freeze([[2, 0], [-2, 0], [0, 2], [0, -2]]);

const CONTROL_GROUPS = {
    tone: [
        { key: "exposure", label: "Exposure", min: -200, max: 200, value: 0, format: (v) => `${v > 0 ? "+" : ""}${(v / 100).toFixed(2)} EV` },
        { key: "contrast", label: "Contrast", min: -50, max: 50, value: 0, format: signed },
        { key: "highlights", label: "Highlights", min: -100, max: 100, value: 0, format: signed },
        { key: "shadows", label: "Shadows", min: -100, max: 100, value: 0, format: signed },
    ],
    color: [
        { key: "temperature", label: "Temperature", min: -50, max: 50, value: 0, format: signed },
        { key: "tint", label: "Tint", min: -50, max: 50, value: 0, format: signed },
        { key: "saturation", label: "Saturation", min: -100, max: 100, value: 0, format: signed },
    ],
    texture: [
        { key: "fade", label: "Fade", min: 0, max: 40, value: 0, format: plain },
        { key: "grain", label: "Grain", min: 0, max: 40, value: 0, format: plain },
        { key: "vignette", label: "Vignette", min: 0, max: 60, value: 12, format: plain },
    ],
    process: [
        { key: "development", label: "Push / Pull", min: -200, max: 200, value: 0, format: processStops },
        { key: "halation", label: "Halation", min: 0, max: 100, value: 0, format: plain },
        { key: "flare", label: "Scan Flare", min: 0, max: 100, value: 0, format: plain },
    ],
};

const controls = Object.values(CONTROL_GROUPS).flat();
const defaults = Object.fromEntries(controls.map((control) => [control.key, control.value]));
const DEFAULT_CROP = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

function vector3(value, fallback) {
    return fallback.map((component, index) => Number(value?.[index] ?? component));
}

function normalizePipeline(value = {}) {
    const scene = value.scene || {};
    const curve = value.curve || {};
    const crossover = value.crossover || {};
    const chemistry = value.chemistry || {};
    const optics = value.optics || {};
    const output = value.output || {};
    const grain = value.grain || {};
    return {
        version: Number(value.version ?? DEFAULT_PIPELINE.version),
        family: value.family || DEFAULT_PIPELINE.family,
        monochrome: Boolean(value.monochrome),
        scene: {
            sensitivity: vector3(scene.sensitivity, DEFAULT_PIPELINE.scene.sensitivity),
            flash: Number(scene.flash ?? DEFAULT_PIPELINE.scene.flash),
        },
        curve: {
            toe: Number(curve.toe ?? DEFAULT_PIPELINE.curve.toe),
            shoulder: Number(curve.shoulder ?? DEFAULT_PIPELINE.curve.shoulder),
            gamma: Number(curve.gamma ?? DEFAULT_PIPELINE.curve.gamma),
            saturationCompression: Number(curve.saturationCompression ?? DEFAULT_PIPELINE.curve.saturationCompression),
        },
        crossover: {
            shadows: vector3(crossover.shadows, DEFAULT_PIPELINE.crossover.shadows),
            highlights: vector3(crossover.highlights, DEFAULT_PIPELINE.crossover.highlights),
        },
        chemistry: {
            silverRetention: Number(chemistry.silverRetention ?? DEFAULT_PIPELINE.chemistry.silverRetention),
            fog: Number(chemistry.fog ?? DEFAULT_PIPELINE.chemistry.fog),
            flare: Number(chemistry.flare ?? DEFAULT_PIPELINE.chemistry.flare),
            localContrast: Number(chemistry.localContrast ?? DEFAULT_PIPELINE.chemistry.localContrast),
        },
        optics: {
            halation: Number(optics.halation ?? DEFAULT_PIPELINE.optics.halation),
            halationRadius: Number(optics.halationRadius ?? DEFAULT_PIPELINE.optics.halationRadius),
            halationThreshold: Number(optics.halationThreshold ?? DEFAULT_PIPELINE.optics.halationThreshold),
        },
        output: {
            tint: vector3(output.tint, DEFAULT_PIPELINE.output.tint),
            scanContrast: Number(output.scanContrast ?? DEFAULT_PIPELINE.output.scanContrast),
        },
        grain: {
            meanRadius: Number(grain.meanRadius ?? DEFAULT_PIPELINE.grain.meanRadius),
            radiusVariance: Number(grain.radiusVariance ?? DEFAULT_PIPELINE.grain.radiusVariance),
            shadowBias: Number(grain.shadowBias ?? DEFAULT_PIPELINE.grain.shadowBias),
            chroma: Number(grain.chroma ?? DEFAULT_PIPELINE.grain.chroma),
        },
    };
}

function normalizeFilmStock(definition) {
    const settings = definition.settings || {};
    const grainProfile = definition.grainProfile || {};
    return {
        id: definition.id,
        name: definition.name,
        maker: definition.maker,
        type: definition.type,
        group: definition.group,
        sort: definition.sort || 0,
        catalog: definition.catalog || null,
        dossier: definition.dossier,
        pipeline: normalizePipeline(definition.pipeline),
        ...settings,
        grainProfile: GRAIN_TRAIT_KEYS.map((key) => grainProfile[key]),
    };
}

async function loadFilmStocks() {
    const response = await fetch("film-stocks/index.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load film stocks (${response.status})`);
    const definitions = await response.json();
    if (!Array.isArray(definitions) || !definitions.length) throw new Error("No film stocks were discovered");
    return definitions.map(normalizeFilmStock).sort((first, second) => first.sort - second.sort);
}

function createDefaultEditState(presetId = "tungsten") {
    return {
        presetId,
        adjustments: { ...defaults },
        grainTraits: { ...STOCK_GRAIN_TRAITS },
        crop: { ...DEFAULT_CROP },
        cropAspect: "free",
        history: [],
    };
}

const state = {
    frames: [],
    activeFrame: -1,
    sourceImage: null,
    sourcePixels: null,
    sourceWidth: 0,
    sourceHeight: 0,
    preset: null,
    adjustments: { ...defaults },
    filter: "all",
    processFilter: "all",
    search: "",
    compare: false,
    grid: false,
    history: [],
    grainTraits: { ...STOCK_GRAIN_TRAITS },
    crop: { ...DEFAULT_CROP },
    cropAspect: "free",
    view: "develop",
    spaceHeld: false,
    renderToken: 0,
    grainSeed: 1,
    grainField: null,
    thumbnailGrainField: null,
    zoom: 1,
    panX: 0,
    panY: 0,
};

const canvas = $("photo-canvas");
const context = canvas.getContext("2d", { willReadFrequently: true });
const histogram = $("histogram");
const histogramContext = histogram.getContext("2d");
const gpuProcessor = GrainlabGPU.createProcessor();
let renderQueued = false;
let renderRunning = false;
let renderPending = false;
let toastTimer;
let panGesture = null;
let cropGesture = null;

function signed(value) {
    return `${value > 0 ? "+" : ""}${value}`;
}

function plain(value) {
    return String(value);
}

function processStops(value) {
    if (value === 0) return "NORMAL";
    const stops = Math.abs(value / 100).toFixed(1);
    return value > 0 ? `PUSH +${stops}` : `PULL −${stops}`;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function addVector(target, delta) {
    return target.map((value, index) => value + delta[index]);
}

function applyProcessModel(pipeline, process, development) {
    if (process === "push") {
        pipeline.curve.toe += 0.06;
        pipeline.curve.gamma *= 1.12;
        pipeline.chemistry.fog += 0.006;
        pipeline.chemistry.localContrast += 0.04;
        pipeline.grain.meanRadius *= 1.12;
        pipeline.grain.radiusVariance += 0.20;
        pipeline.grain.shadowBias += 0.18;
        if (!pipeline.monochrome) {
            pipeline.crossover.shadows = addVector(pipeline.crossover.shadows, [-0.012, 0.002, 0.018]);
        }
    } else if (process === "pull") {
        pipeline.curve.shoulder += 0.15;
        pipeline.curve.gamma *= 0.88;
        pipeline.curve.saturationCompression += 0.08;
        pipeline.grain.meanRadius *= 0.88;
        pipeline.grain.radiusVariance *= 0.75;
    } else if (process === "motion") {
        pipeline.curve.shoulder += 0.10;
        pipeline.curve.saturationCompression += 0.06;
        pipeline.grain.meanRadius *= 0.92;
        pipeline.grain.radiusVariance *= 0.86;
        pipeline.grain.chroma *= 0.72;
    } else if (process === "bleach") {
        pipeline.curve.gamma *= 1.10;
        pipeline.curve.saturationCompression += 0.42;
        pipeline.chemistry.silverRetention = Math.max(0.68, pipeline.chemistry.silverRetention);
        pipeline.chemistry.localContrast += 0.08;
        pipeline.grain.chroma = 0;
    } else if (process === "cross") {
        pipeline.curve.gamma *= 1.08;
        pipeline.crossover.shadows = addVector(pipeline.crossover.shadows, [-0.045, 0.018, 0.055]);
        pipeline.crossover.highlights = addVector(pipeline.crossover.highlights, [0.045, -0.012, -0.035]);
        pipeline.chemistry.fog += 0.008;
        pipeline.grain.chroma += 0.025;
    }

    const pushed = Math.max(0, development);
    const pulled = Math.max(0, -development);
    pipeline.curve.toe += pushed * 0.05;
    pipeline.curve.shoulder += pulled * 0.10;
    pipeline.curve.gamma *= 1 + pushed * 0.16 - pulled * 0.10;
    pipeline.curve.saturationCompression += pulled * 0.04;
    pipeline.chemistry.fog += pushed * 0.006;
    pipeline.chemistry.localContrast += pushed * 0.03 - pulled * 0.02;
    pipeline.grain.meanRadius *= 1 + pushed * 0.12 - pulled * 0.08;
    pipeline.grain.radiusVariance += pushed * 0.18;
    pipeline.grain.shadowBias += pushed * 0.20;

    pipeline.curve.toe = clamp(pipeline.curve.toe, 0, 1);
    pipeline.curve.shoulder = clamp(pipeline.curve.shoulder, 0, 1);
    pipeline.curve.gamma = clamp(pipeline.curve.gamma, 0.45, 1.8);
    pipeline.curve.saturationCompression = clamp(pipeline.curve.saturationCompression, 0, 1);
    pipeline.chemistry.fog = clamp(pipeline.chemistry.fog, 0, 0.2);
    pipeline.chemistry.localContrast = clamp(pipeline.chemistry.localContrast, 0, 0.4);
    pipeline.grain.meanRadius = clamp(pipeline.grain.meanRadius, 0.2, 2.5);
    pipeline.grain.radiusVariance = clamp(pipeline.grain.radiusVariance, 0, 1.5);
    pipeline.grain.shadowBias = clamp(pipeline.grain.shadowBias, 0, 1.5);
    pipeline.grain.chroma = clamp(pipeline.grain.chroma, 0, 0.15);
}

function combinedSettings(preset = state.preset, adjustments = state.adjustments, grainTraits = state.grainTraits) {
    const stockProfile = Object.fromEntries(GRAIN_TRAIT_KEYS.map((key, index) => [key, preset.grainProfile[index]]));
    const grainProfile = Object.fromEntries(GRAIN_TRAIT_KEYS.map((key) => [
        key,
        grainTraits[key] === "stock" ? stockProfile[key] : grainTraits[key],
    ]));
    const pipeline = normalizePipeline(preset.pipeline);
    const development = (adjustments.development || 0) / 100;
    applyProcessModel(pipeline, grainProfile.process, development);
    pipeline.optics.halation = clamp(pipeline.optics.halation + (adjustments.halation || 0) * 0.004, 0, 0.7);
    pipeline.chemistry.flare = clamp(pipeline.chemistry.flare + (adjustments.flare || 0) * 0.0008, 0, 0.15);
    const pushed = Math.max(0, development);
    const pulled = Math.max(0, -development);
    const temperature = (preset.temperature || 0) + adjustments.temperature;
    const tint = (preset.tint || 0) + adjustments.tint;
    return {
        exposure: (preset.exposure || 0) + adjustments.exposure / 100 - pushed * 0.35 + pulled * 0.25,
        contrast: (preset.contrast || 0) + adjustments.contrast,
        highlights: adjustments.highlights,
        shadows: adjustments.shadows,
        temperature,
        tint,
        whiteBalance: [2 ** (temperature / 120), 2 ** (tint / 160), 2 ** (-temperature / 120)],
        saturation: (preset.saturation || 0) + adjustments.saturation,
        fade: (preset.fade || 0) + adjustments.fade,
        grain: (preset.grain || 0) + adjustments.grain,
        vignette: adjustments.vignette,
        grainProfile,
        pipeline,
    };
}

function srgbToLinear(value) {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value) {
    const bounded = clamp(value, 0, 1);
    const encoded = bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * bounded ** (1 / 2.4) - 0.055;
    return encoded * 255;
}

function relativeLuminance(red, green, blue) {
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function toeFunction(value) {
    const bounded = clamp(value, 0, 1);
    return bounded * bounded * 1.18 / (bounded + 0.18);
}

function filmCurve(value, curve) {
    let bounded = Math.max(0, value);
    bounded /= 1 + curve.shoulder * Math.max(0, bounded - 1) * 2;
    bounded = clamp(bounded, 0, 1);
    bounded += (toeFunction(bounded) - bounded) * curve.toe;
    bounded += (1 - toeFunction(1 - bounded) - bounded) * curve.shoulder;
    return clamp(bounded, 0, 1) ** curve.gamma;
}

function buildSceneBuffer(source, settings) {
    const scene = new Float32Array(source.width * source.height * 3);
    const pipeline = settings.pipeline;
    const exposure = 2 ** settings.exposure;
    const sensitivity = pipeline.scene.sensitivity;
    const whiteBalance = settings.whiteBalance;
    for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
        const sourceIndex = pixel * 4;
        const sceneIndex = pixel * 3;
        const red = srgbToLinear(source.data[sourceIndex]) * exposure * whiteBalance[0];
        const green = srgbToLinear(source.data[sourceIndex + 1]) * exposure * whiteBalance[1];
        const blue = srgbToLinear(source.data[sourceIndex + 2]) * exposure * whiteBalance[2];
        if (pipeline.monochrome) {
            const neutral = red * sensitivity[0] + green * sensitivity[1] + blue * sensitivity[2] + pipeline.scene.flash;
            scene[sceneIndex] = neutral;
            scene[sceneIndex + 1] = neutral;
            scene[sceneIndex + 2] = neutral;
        } else {
            scene[sceneIndex] = red * sensitivity[0] + pipeline.scene.flash;
            scene[sceneIndex + 1] = green * sensitivity[1] + pipeline.scene.flash;
            scene[sceneIndex + 2] = blue * sensitivity[2] + pipeline.scene.flash;
        }
    }
    return scene;
}

function sceneIndex(width, height, x, y) {
    return (clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 3;
}

function haloSignal(scene, index, threshold) {
    const red = scene[index];
    const green = scene[index + 1];
    const blue = scene[index + 2];
    const luminance = relativeLuminance(red, green, blue);
    const mask = clamp((luminance - threshold) / Math.max(0.001, 1 - threshold), 0, 1);
    return Math.max(red, green, blue) * mask;
}

function buildSpatialModel(width, height, pipeline) {
    const radius = Math.max(1, Math.round(pipeline.optics.halationRadius * Math.max(width, height) / 2048));
    const half = Math.max(1, Math.round(radius / 2));
    return {
        haloAmount: pipeline.optics.halation,
        haloThreshold: pipeline.optics.halationThreshold,
        haloOffsets: [[radius, 0], [-radius, 0], [0, radius], [0, -radius], [half, half], [-half, half], [half, -half], [-half, -half]],
        localContrast: pipeline.chemistry.localContrast,
    };
}

function spatialSignals(scene, width, height, x, y, model) {
    let halo = 0;
    if (model.haloAmount > 0) {
        for (const [offsetX, offsetY] of model.haloOffsets) {
            halo += haloSignal(scene, sceneIndex(width, height, x + offsetX, y + offsetY), model.haloThreshold);
        }
        halo = halo / model.haloOffsets.length * model.haloAmount * 0.28;
    }

    let localDetail = 0;
    if (model.localContrast > 0) {
        const center = sceneIndex(width, height, x, y);
        const centerLuminance = relativeLuminance(scene[center], scene[center + 1], scene[center + 2]);
        let neighborhood = 0;
        for (const [offsetX, offsetY] of LOCAL_DENSITY_OFFSETS) {
            const index = sceneIndex(width, height, x + offsetX, y + offsetY);
            neighborhood += relativeLuminance(scene[index], scene[index + 1], scene[index + 2]);
        }
        localDetail = (centerLuminance - neighborhood / 4) * model.localContrast;
    }
    return { halo, localDetail };
}

function processImageData(source, settings, showOriginal = false, grainField = state.grainField) {
    const output = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
    if (showOriginal) return output;

    const pixels = output.data;
    const width = source.width;
    const height = source.height;
    const scene = buildSceneBuffer(source, settings);
    const pipeline = settings.pipeline;
    const spatialModel = buildSpatialModel(width, height, pipeline);
    const contrast = 1 + settings.contrast / 100;
    const saturation = Math.max(0, 1 + settings.saturation / 100);
    const fade = settings.fade * 0.0043;
    const vignette = settings.vignette / 100;
    const centerX = width / 2;
    const centerY = height / 2;
    const maximumDistance = Math.sqrt(centerX * centerX + centerY * centerY);
    const grainSampler = GrainlabGrain.createEmulsionGrainSampler(
        width,
        height,
        grainField,
        settings.grain,
        settings.grainProfile,
        pipeline.grain,
    );
    const grainSample = new Float32Array(6);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const sceneOffset = (y * width + x) * 3;
            let red = scene[sceneOffset];
            let green = scene[sceneOffset + 1];
            let blue = scene[sceneOffset + 2];
            const { halo, localDetail } = spatialSignals(scene, width, height, x, y, spatialModel);
            if (pipeline.monochrome) {
                red += halo;
                green += halo;
                blue += halo;
            } else {
                red += halo;
                green += halo * 0.30;
                blue += halo * 0.08;
            }

            if (grainSampler) {
                grainSampler.sample(x, y, red, green, blue, grainSample);
                red = grainSample[0];
                green = grainSample[1];
                blue = grainSample[2];
            }

            red = filmCurve(red, pipeline.curve) + grainSample[3];
            green = filmCurve(green, pipeline.curve) + grainSample[4];
            blue = filmCurve(blue, pipeline.curve) + grainSample[5];

            let neutral = relativeLuminance(red, green, blue);
            const shadowMask = (1 - clamp(neutral, 0, 1)) ** 2;
            const highlightMask = clamp(neutral, 0, 1) ** 2;
            red += pipeline.crossover.shadows[0] * shadowMask + pipeline.crossover.highlights[0] * highlightMask;
            green += pipeline.crossover.shadows[1] * shadowMask + pipeline.crossover.highlights[1] * highlightMask;
            blue += pipeline.crossover.shadows[2] * shadowMask + pipeline.crossover.highlights[2] * highlightMask;

            neutral = relativeLuminance(red, green, blue);
            const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
            const emulsionSaturation = 1 / (1 + pipeline.curve.saturationCompression * chroma * 2);
            red = neutral + (red - neutral) * emulsionSaturation;
            green = neutral + (green - neutral) * emulsionSaturation;
            blue = neutral + (blue - neutral) * emulsionSaturation;

            const silverRetention = pipeline.chemistry.silverRetention;
            neutral = relativeLuminance(red, green, blue);
            red = neutral + (red - neutral) * (1 - silverRetention * 0.78);
            green = neutral + (green - neutral) * (1 - silverRetention * 0.78);
            blue = neutral + (blue - neutral) * (1 - silverRetention * 0.78);
            const chemicalContrast = 1 + silverRetention * 0.46;
            const chemicalBase = pipeline.chemistry.fog + pipeline.chemistry.flare + localDetail;
            red = (red - 0.18) * chemicalContrast + 0.18 + chemicalBase;
            green = (green - 0.18) * chemicalContrast + 0.18 + chemicalBase;
            blue = (blue - 0.18) * chemicalContrast + 0.18 + chemicalBase;

            neutral = relativeLuminance(red, green, blue);
            const boundedLuminance = clamp(neutral, 0, 1);
            const shadowShift = settings.shadows / 100 * 0.12 * (1 - boundedLuminance) ** 2;
            const highlightShift = settings.highlights / 100 * 0.12 * boundedLuminance ** 2;
            red += shadowShift + highlightShift;
            green += shadowShift + highlightShift;
            blue += shadowShift + highlightShift;

            red = (red - 0.18) * pipeline.output.scanContrast + 0.18;
            green = (green - 0.18) * pipeline.output.scanContrast + 0.18;
            blue = (blue - 0.18) * pipeline.output.scanContrast + 0.18;
            red = (red - 0.18) * contrast + 0.18;
            green = (green - 0.18) * contrast + 0.18;
            blue = (blue - 0.18) * contrast + 0.18;

            neutral = relativeLuminance(red, green, blue);
            red = neutral + (red - neutral) * saturation;
            green = neutral + (green - neutral) * saturation;
            blue = neutral + (blue - neutral) * saturation;

            if (fade > 0) {
                red = red * (1 - fade) + fade * 0.10;
                green = green * (1 - fade) + fade * 0.104;
                blue = blue * (1 - fade) + fade * 0.096;
            }
            if (vignette > 0) {
                const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2) / maximumDistance;
                const edge = Math.max(0, (distance - 0.25) / 0.75);
                const factor = 1 - vignette * edge * edge * 0.85;
                red *= factor;
                green *= factor;
                blue *= factor;
            }

            pixels[index] = linearToSrgb(red * pipeline.output.tint[0]);
            pixels[index + 1] = linearToSrgb(green * pipeline.output.tint[1]);
            pixels[index + 2] = linearToSrgb(blue * pipeline.output.tint[2]);
            pixels[index + 3] = source.data[index + 3];
        }
    }

    return output;
}

function queueRender() {
    if (!state.sourcePixels) return;
    renderPending = true;
    if (renderQueued || renderRunning) return;
    renderQueued = true;
    requestAnimationFrame(async () => {
        renderQueued = false;
        renderRunning = true;
        try {
            do {
                renderPending = false;
                await renderPhoto();
            } while (renderPending);
        } catch (error) {
            console.error(error);
            setConsole("renderer recovered after an error");
        } finally {
            renderRunning = false;
            if (renderPending) queueRender();
        }
    });
}

function ensureCpuGrainField() {
    if (!state.grainField) {
        state.grainField = GrainlabGrain.createFilmGrainField(
            state.sourceWidth,
            state.sourceHeight,
            state.grainSeed,
        );
    }
    return state.grainField;
}

async function renderWithBestEngine(source, settings, showOriginal = false, grainField = state.grainField) {
    if (showOriginal) return processImageData(source, settings, true, grainField);
    try {
        const gpuOutput = await gpuProcessor.process(
            source,
            settings,
            state.grainSeed,
            false,
            source === state.sourcePixels,
        );
        if (gpuOutput) {
            $("render-engine").textContent = "WGSL / GPU";
            return gpuOutput;
        }
    } catch (error) {
        console.warn("WGSL render failed; using CPU fallback.", error);
    }
    $("render-engine").textContent = "CPU / SAFE";
    const fallbackField = grainField || (source === state.sourcePixels
        ? ensureCpuGrainField()
        : GrainlabGrain.createFilmGrainField(source.width, source.height, state.grainSeed));
    return processImageData(source, settings, false, fallbackField);
}

async function renderPhoto() {
    if (!state.sourcePixels) return;
    const token = ++state.renderToken;
    const output = await renderWithBestEngine(state.sourcePixels, combinedSettings(), state.compare);
    if (token !== state.renderToken) return;
    if (canvas.width !== output.width || canvas.height !== output.height) {
        canvas.width = output.width;
        canvas.height = output.height;
    }
    context.putImageData(output, 0, 0);
    drawHistogram(output);
    updateImageBadge();
}

function drawHistogram(imageData) {
    const values = new Uint32Array(64);
    const pixels = imageData.data;
    for (let index = 0; index < pixels.length; index += 32) {
        const luminance = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
        values[Math.min(63, Math.floor(luminance / 4))] += 1;
    }
    const peak = Math.max(...values, 1);
    const width = histogram.width;
    const height = histogram.height;
    histogramContext.clearRect(0, 0, width, height);
    histogramContext.fillStyle = "#080c0a";
    histogramContext.fillRect(0, 0, width, height);
    histogramContext.fillStyle = "rgba(105, 229, 166, 0.72)";
    values.forEach((value, index) => {
        const barWidth = width / values.length;
        const barHeight = (value / peak) * (height - 5);
        histogramContext.fillRect(index * barWidth, height - barHeight, Math.max(1, barWidth - 1), barHeight);
    });
}

function buildControls() {
    Object.entries(CONTROL_GROUPS).forEach(([group, groupControls]) => {
        const container = $(`${group}-controls`);
        groupControls.forEach((control) => {
            const wrapper = document.createElement("div");
            wrapper.className = "slider-control";
            wrapper.innerHTML = `
                <div class="slider-header">
                    <label for="control-${control.key}">${control.label}</label>
                    <output id="output-${control.key}">${control.format(control.value)}</output>
                </div>
                <div class="range-wrap">
                    <input id="control-${control.key}" data-control="${control.key}" data-group="${group}" type="range" min="${control.min}" max="${control.max}" value="${control.value}">
                </div>`;
            container.appendChild(wrapper);
            const input = wrapper.querySelector("input");
            input.addEventListener("pointerdown", () => snapshotHistory(`Adjust · ${control.label}`));
            input.addEventListener("keydown", (event) => {
                if (!event.repeat && ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                    snapshotHistory(`Adjust · ${control.label}`);
                }
            });
            input.addEventListener("input", () => {
                state.adjustments[control.key] = Number(input.value);
                $(`output-${control.key}`).textContent = control.format(Number(input.value));
                setConsole(`${control.label.toLowerCase()} ${control.format(Number(input.value))}`);
                if (group === "process") updateGrainProfileSummary();
                queueRender();
            });
        });
    });
    buildGrainTraitControls();
}

function buildGrainTraitControls() {
    const container = $("grain-trait-controls");
    GRAIN_TRAIT_KEYS.forEach((key) => {
        const trait = GRAIN_TRAITS[key];
        const label = document.createElement("label");
        label.className = "grain-trait";
        label.innerHTML = `
            <span>${trait.label}</span>
            <select id="grain-trait-${key}" aria-label="Grain ${trait.label.toLowerCase()}">
                ${trait.options.map(([value, name]) => `<option value="${value}">${name}</option>`).join("")}
            </select>`;
        container.appendChild(label);
        const select = label.querySelector("select");
        select.addEventListener("change", () => {
            snapshotHistory(`Grain · ${trait.label}`);
            state.grainTraits[key] = select.value;
            updateGrainProfileSummary();
            setConsole(`grain ${trait.label.toLowerCase()}: ${select.options[select.selectedIndex].text.toLowerCase()}`);
            queueRender();
        });
    });
    syncGrainControls();
}

function updateGrainProfileSummary() {
    const settings = combinedSettings();
    const profile = settings.grainProfile;
    const pipeline = settings.pipeline;
    const isStockMatched = GRAIN_TRAIT_KEYS.every((key) => state.grainTraits[key] === "stock");
    $("grain-profile-summary").textContent = isStockMatched ? "STOCK MATCH" : "CUSTOM";
    $("grain-model-note").textContent = [
        profile.medium === "silver" ? "METALLIC SILVER" : "DYE CLOUDS",
        profile.crystal === "tabular" ? "T-GRAIN" : profile.crystal.toUpperCase(),
        profile.emulsion.replace("-", " ").toUpperCase(),
        profile.scale.toUpperCase(),
        profile.process.toUpperCase(),
    ].join(" / ");
    const familyNames = { utility: "UTILITY", bw: "B&W", c41: "C-41", e6: "E-6", ecn2: "ECN-2", print: "PRINT" };
    $("pipeline-model-note").textContent = [
        familyNames[pipeline.family] || pipeline.family.toUpperCase(),
        `TOE ${pipeline.curve.toe.toFixed(2)}`,
        `SHOULDER ${pipeline.curve.shoulder.toFixed(2)}`,
        `γ ${pipeline.curve.gamma.toFixed(2)}`,
        `HALATION ${Math.round(pipeline.optics.halation * 100)}`,
    ].join(" / ");
}

function syncGrainControls() {
    GRAIN_TRAIT_KEYS.forEach((key) => {
        $(`grain-trait-${key}`).value = state.grainTraits[key];
    });
    updateGrainProfileSummary();
}

function syncControls() {
    controls.forEach((control) => {
        const input = $(`control-${control.key}`);
        input.value = state.adjustments[control.key];
        $(`output-${control.key}`).textContent = control.format(state.adjustments[control.key]);
    });
    syncGrainControls();
}

function filteredPresets() {
    const query = state.search.trim().toLowerCase();
    return PRESETS.filter((preset) => {
        const matchesType = state.filter === "all" || preset.type === state.filter;
        const matchesProcess = state.processFilter === "all" || preset.pipeline.family === state.processFilter;
        const searchIndex = `${preset.name} ${preset.maker} ${preset.group} ${JSON.stringify(preset.catalog)} ${JSON.stringify(preset.dossier)}`.toLowerCase();
        const matchesQuery = !query || searchIndex.includes(query);
        return matchesType && matchesProcess && matchesQuery;
    });
}

function observePresetThumbnail(canvas, preset, list) {
    thumbnailPresets.set(canvas, preset);
    if (!("IntersectionObserver" in window)) {
        renderPresetThumbnail(canvas, preset);
        return;
    }
    if (!presetThumbnailObserver) {
        presetThumbnailObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting || !state.sourceImage) return;
                renderPresetThumbnail(entry.target, thumbnailPresets.get(entry.target));
                observer.unobserve(entry.target);
            });
        }, { root: list, rootMargin: "180px 0px" });
    }
    presetThumbnailObserver.observe(canvas);
}

function renderPresetList() {
    const list = $("preset-list");
    const presets = filteredPresets();
    presetThumbnailObserver?.disconnect();
    presetThumbnailObserver = null;
    list.innerHTML = "";
    $("preset-count").textContent = `${presets.length} STOCK${presets.length === 1 ? "" : "S"}`;

    if (!presets.length) {
        list.innerHTML = '<div class="empty-presets"><span class="terminal-prompt">!</span>No film stocks match this query.</div>';
        return;
    }

    const groups = new Map();
    presets.forEach((preset) => {
        if (!groups.has(preset.group)) groups.set(preset.group, []);
        groups.get(preset.group).push(preset);
    });

    groups.forEach((groupPresets, groupName) => {
        const label = document.createElement("div");
        label.className = "preset-group-label";
        label.innerHTML = `<span>${groupName}</span><span>${String(groupPresets.length).padStart(2, "0")}</span>`;
        list.appendChild(label);

        groupPresets.forEach((preset) => {
            const originalIndex = PRESETS.indexOf(preset);
            const entry = document.createElement("div");
            entry.className = `preset-entry${state.preset.id === preset.id ? " is-active" : ""}`;
            const row = document.createElement("button");
            row.className = `preset-row${state.preset.id === preset.id ? " is-active" : ""}`;
            row.dataset.preset = preset.id;
            row.setAttribute("aria-pressed", String(state.preset.id === preset.id));
            row.innerHTML = `
                <canvas width="84" height="68" aria-hidden="true"></canvas>
                <span>
                    <span class="preset-name">${preset.name}</span>
                    <span class="preset-meta">${preset.maker} · ${preset.type}${preset.catalog ? ` · #${String(preset.catalog.rank).padStart(3, "0")}` : ""}</span>
                </span>
                <span class="preset-index">${String(originalIndex + 1).padStart(2, "0")}</span>`;
            row.addEventListener("click", () => selectPreset(preset));
            const info = document.createElement("button");
            info.className = "preset-info-button";
            info.type = "button";
            info.setAttribute("aria-label", `Open ${preset.name} technical dossier`);
            info.title = `${preset.name} · stock dossier`;
            info.textContent = "i";
            info.addEventListener("click", () => openStockDossier(preset));
            entry.append(row, info);
            list.appendChild(entry);
            observePresetThumbnail(row.querySelector("canvas"), preset, list);
        });
    });
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
    })[character]);
}

function dossierDetailList(details = []) {
    return details.map((detail) => `
        <div class="dossier-detail">
            <dt>${escapeHTML(detail.label)}</dt>
            <dd>${escapeHTML(detail.value)}</dd>
        </div>`).join("");
}

function renderStockDossier(preset) {
    const dossier = preset.dossier;
    const reference = dossier.reference;
    $("stock-dossier-title").textContent = preset.name;
    $("stock-dossier-content").innerHTML = `
        <section class="dossier-hero">
            <div class="dossier-identity">
                <div class="dossier-code">${preset.catalog ? `CENTURY CANON ${String(preset.catalog.rank).padStart(3, "0")}/100` : `GL/${String(PRESETS.indexOf(preset) + 1).padStart(2, "0")}`} · ${escapeHTML(preset.type.toUpperCase())}</div>
                <p class="dossier-tagline">${escapeHTML(dossier.tagline)}</p>
                <p class="dossier-portrait">${escapeHTML(dossier.portrait)}</p>
                <div class="dossier-reference">
                    <span>REFERENCE LINEAGE</span>
                    <strong>${escapeHTML(reference.manufacturer)} · ${escapeHTML(reference.stock)}</strong>
                    <small>${escapeHTML(reference.relationship)} · ${escapeHTML(reference.status)}</small>
                </div>
            </div>
            <div class="dossier-palette" aria-label="Characteristic color palette">
                ${dossier.palette.map((swatch) => `
                    <div class="palette-swatch" style="--swatch:${escapeHTML(swatch.hex)}">
                        <span></span><small>${escapeHTML(swatch.name)}</small>
                    </div>`).join("")}
            </div>
        </section>
        <section class="dossier-facts" aria-label="Film stock quick facts">
            ${dossier.facts.map((fact) => `
                <div>
                    <span>${escapeHTML(fact.label)}</span>
                    <strong>${escapeHTML(fact.value)}</strong>
                    ${fact.note ? `<small>${escapeHTML(fact.note)}</small>` : ""}
                </div>`).join("")}
        </section>
        <div class="dossier-chapters">
            ${dossier.chapters.map((chapter, index) => `
                <section class="dossier-chapter">
                    <div class="chapter-number">${String(index + 1).padStart(2, "0")}</div>
                    <div>
                        <span class="eyebrow">${escapeHTML(chapter.eyebrow)}</span>
                        <h2>${escapeHTML(chapter.title)}</h2>
                        <p>${escapeHTML(chapter.lede)}</p>
                        <dl>${dossierDetailList(chapter.details)}</dl>
                        ${chapter.notes?.length ? `<ul>${chapter.notes.map((note) => `<li>${escapeHTML(note)}</li>`).join("")}</ul>` : ""}
                    </div>
                </section>`).join("")}
        </div>
        <section class="dossier-field-grid">
            <div>
                <span class="eyebrow">REACH FOR IT</span>
                <ul>${dossier.bestFor.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>
            </div>
            <div>
                <span class="eyebrow">WATCH THE NEGATIVE</span>
                <ul>${dossier.watchFor.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>
            </div>
        </section>
        <section class="dossier-notes">
            <span class="eyebrow">CONTACT SHEET MARGINALIA</span>
            ${dossier.fieldNotes.map((note) => `<blockquote>${escapeHTML(note)}</blockquote>`).join("")}
        </section>
        <section class="dossier-sources">
            <div class="dossier-source-heading">
                <div>
                    <span class="eyebrow">PRIMARY SOURCES</span>
                    <p>Manufacturer literature informs the reference facts. Rendering remains an artistic Grainlab interpretation.</p>
                </div>
                <span>VERIFIED ${escapeHTML(dossier.verified)}</span>
            </div>
            ${dossier.sources.map((source, index) => `
                <button type="button" class="dossier-source" data-source-url="${escapeHTML(source.url)}">
                    <span>${String(index + 1).padStart(2, "0")}</span>
                    <span><strong>${escapeHTML(source.title)}</strong><small>${escapeHTML(source.publisher)}</small></span>
                    <span>COPY URL</span>
                </button>`).join("")}
        </section>
        <footer class="dossier-disclaimer">${escapeHTML(dossier.disclaimer)}</footer>`;
}

function openStockDossier(preset = state.preset) {
    if (!preset?.dossier) return;
    renderStockDossier(preset);
    $("stock-overlay").hidden = false;
    $("close-stock-overlay").focus();
}

function closeStockDossier() {
    $("stock-overlay").hidden = true;
}

async function copySourceUrl(url) {
    try {
        await navigator.clipboard.writeText(url);
        showToast("SOURCE URL COPIED");
    } catch (_error) {
        showToast("COPY BLOCKED · URL SHOWN IN CONSOLE");
        console.info(url);
    }
}

function renderPresetThumbnail(target, preset) {
    if (!state.sourceImage) return;
    const thumbContext = target.getContext("2d", { willReadFrequently: true });
    const targetRatio = target.width / target.height;
    const sourceRatio = state.sourceImage.naturalWidth / state.sourceImage.naturalHeight;
    let sourceWidth = state.sourceImage.naturalWidth;
    let sourceHeight = state.sourceImage.naturalHeight;
    let sourceX = 0;
    let sourceY = 0;
    if (sourceRatio > targetRatio) {
        sourceWidth = sourceHeight * targetRatio;
        sourceX = (state.sourceImage.naturalWidth - sourceWidth) / 2;
    } else {
        sourceHeight = sourceWidth / targetRatio;
        sourceY = (state.sourceImage.naturalHeight - sourceHeight) / 2;
    }
    thumbContext.drawImage(state.sourceImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, target.width, target.height);
    const source = thumbContext.getImageData(0, 0, target.width, target.height);
    const settings = combinedSettings(preset, { ...defaults, vignette: 0 }, STOCK_GRAIN_TRAITS);
    thumbContext.putImageData(processImageData(source, settings, false, state.thumbnailGrainField), 0, 0);
}

function selectPreset(preset) {
    if (state.preset.id === preset.id) return;
    snapshotHistory(`Stock · ${preset.name}`);
    state.preset = preset;
    updateGrainProfileSummary();
    renderPresetList();
    setConsole(`stock selected: ${preset.name.toLowerCase()}`);
    queueRender();
}

function selectPresetByOffset(offset) {
    if (document.activeElement?.matches("input")) return;
    const presets = filteredPresets();
    if (!presets.length) return;
    const currentIndex = Math.max(0, presets.findIndex((preset) => preset.id === state.preset.id));
    selectPreset(presets[(currentIndex + offset + presets.length) % presets.length]);
}

function snapshotHistory(label = "Edit") {
    const snapshot = {
        label,
        presetId: state.preset.id,
        adjustments: { ...state.adjustments },
        grainTraits: { ...state.grainTraits },
        crop: { ...state.crop },
        cropAspect: state.cropAspect,
    };
    const latest = state.history[state.history.length - 1];
    const comparable = ({ label: _label, ...value }) => value;
    if (!latest || JSON.stringify(comparable(latest)) !== JSON.stringify(comparable(snapshot))) {
        state.history.push(snapshot);
        if (state.history.length > 30) state.history.shift();
    }
    $("undo-button").disabled = state.history.length === 0;
    renderHistoryPanel();
}

function restoreEditSnapshot(snapshot) {
    state.preset = PRESETS.find((preset) => preset.id === snapshot.presetId) || PRESETS[0];
    state.adjustments = { ...defaults, ...snapshot.adjustments };
    state.grainTraits = { ...(snapshot.grainTraits || STOCK_GRAIN_TRAITS) };
    state.crop = { ...(snapshot.crop || DEFAULT_CROP) };
    state.cropAspect = snapshot.cropAspect || "free";
    syncControls();
    syncCropUi();
    renderPresetList();
    queueRender();
}

function renderHistoryPanel() {
    const list = $("history-list");
    if (!list) return;
    list.innerHTML = "";
    $("history-count").textContent = String(state.history.length).padStart(2, "0");

    const current = document.createElement("div");
    current.className = "history-current";
    current.innerHTML = '<span class="history-step">NOW</span><span class="history-label">Current edit</span>';
    list.appendChild(current);

    if (!state.history.length) {
        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.innerHTML = '<span class="history-step">00</span><span class="history-label">Frame opened</span>';
        list.appendChild(empty);
        return;
    }

    [...state.history].reverse().forEach((entry, reverseIndex) => {
        const index = state.history.length - 1 - reverseIndex;
        const button = document.createElement("button");
        button.className = "history-entry";
        button.title = `Revert before ${entry.label}`;
        button.innerHTML = `<span class="history-step">-${String(reverseIndex + 1).padStart(2, "0")}</span><span class="history-label">${entry.label}</span>`;
        button.addEventListener("click", () => {
            const snapshot = state.history[index];
            state.history = state.history.slice(0, index);
            restoreEditSnapshot(snapshot);
            renderHistoryPanel();
            setConsole(`history restored before ${entry.label.toLowerCase()}`);
        });
        list.appendChild(button);
    });
}

function undo() {
    const snapshot = state.history.pop();
    if (!snapshot) return;
    restoreEditSnapshot(snapshot);
    $("undo-button").disabled = state.history.length === 0;
    renderHistoryPanel();
    setConsole("undo complete");
}

function resetGroup(group) {
    snapshotHistory(`Reset · ${group}`);
    CONTROL_GROUPS[group].forEach((control) => {
        state.adjustments[control.key] = control.value;
    });
    if (group === "texture") state.grainTraits = { ...STOCK_GRAIN_TRAITS };
    syncControls();
    queueRender();
    setConsole(`${group} controls zeroed`);
}

function resetFrame() {
    snapshotHistory("Reset · Frame");
    state.adjustments = { ...defaults };
    state.grainTraits = { ...STOCK_GRAIN_TRAITS };
    state.preset = PRESETS.find((preset) => preset.id === "neutral");
    state.crop = { ...DEFAULT_CROP };
    state.cropAspect = "free";
    syncControls();
    syncCropUi();
    renderPresetList();
    queueRender();
    setConsole("frame reset to clean scan");
}

async function addFiles(files) {
    const validFiles = [...files]
        .filter(isImageFile)
        .sort((first, second) => {
            const firstPath = first.webkitRelativePath || first.name;
            const secondPath = second.webkitRelativePath || second.name;
            return firstPath.localeCompare(secondPath, undefined, { numeric: true, sensitivity: "base" });
        });
    if (!validFiles.length) {
        showToast("NO IMAGE DATA · use JPG, PNG, or WEBP");
        return;
    }

    validFiles.forEach((file) => {
        const url = URL.createObjectURL(file);
        state.frames.push({
            name: file.name,
            path: file.webkitRelativePath || file.name,
            url,
            revoke: true,
            editState: createDefaultEditState(state.preset.id),
        });
    });
    renderFrameList();
    await selectFrame(state.frames.length - validFiles.length);
    const fromFolder = validFiles.some((file) => file.webkitRelativePath);
    setConsole(`${validFiles.length} frame${validFiles.length === 1 ? "" : "s"} imported${fromFolder ? " from folder" : ""}`);
}

function isImageFile(file) {
    return file.type.startsWith("image/") || /\.(?:jpe?g|png|webp)$/i.test(file.name);
}

function cloneEditState(editState) {
    return {
        presetId: editState.presetId,
        adjustments: { ...editState.adjustments },
        grainTraits: { ...editState.grainTraits },
        crop: { ...editState.crop },
        cropAspect: editState.cropAspect,
        history: editState.history.map((entry) => ({
            ...entry,
            adjustments: { ...entry.adjustments },
            grainTraits: { ...entry.grainTraits },
            crop: { ...entry.crop },
        })),
    };
}

function saveActiveFrameEditState() {
    const frame = state.frames[state.activeFrame];
    if (!frame || !state.preset) return;
    frame.editState = cloneEditState({
        presetId: state.preset.id,
        adjustments: state.adjustments,
        grainTraits: state.grainTraits,
        crop: state.crop,
        cropAspect: state.cropAspect,
        history: state.history,
    });
}

function loadFrameEditState(frame) {
    const editState = cloneEditState(frame.editState || createDefaultEditState(state.preset.id));
    state.preset = PRESETS.find((preset) => preset.id === editState.presetId) || PRESETS[0];
    state.adjustments = { ...defaults, ...editState.adjustments };
    state.grainTraits = editState.grainTraits;
    state.crop = editState.crop;
    state.cropAspect = editState.cropAspect;
    state.history = editState.history;
}

async function selectFrame(index) {
    const frame = state.frames[index];
    if (!frame) return;
    if (state.activeFrame !== index) saveActiveFrameEditState();
    state.activeFrame = index;
    loadFrameEditState(frame);
    const image = new Image();
    image.decoding = "async";
    image.src = frame.url;
    await image.decode();
    state.sourceImage = image;
    state.sourceWidth = image.naturalWidth;
    state.sourceHeight = image.naturalHeight;
    const grainSeed = GrainlabGrain.hashString(`${frame.name}:${state.sourceWidth}x${state.sourceHeight}`);
    state.grainSeed = grainSeed;
    state.sourcePixels = null;
    state.grainField = null;
    state.thumbnailGrainField = GrainlabGrain.createFilmGrainField(84, 68, grainSeed ^ 0x9e3779b9);
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    loadFullResolutionSource();

    $("document-name").textContent = frame.name;
    $("document-meta").textContent = `${state.sourceWidth} × ${state.sourceHeight} · RGB`;
    syncControls();
    syncCropUi();
    renderHistoryPanel();
    $("undo-button").disabled = state.history.length === 0;
    renderFrameList();
    renderPresetList();
    requestAnimationFrame(applyZoom);
}

function renderFrameList() {
    const list = $("frame-list");
    list.innerHTML = "";
    state.frames.forEach((frame, index) => {
        const button = document.createElement("button");
        button.className = `frame-thumb${index === state.activeFrame ? " is-active" : ""}`;
        button.setAttribute("aria-label", `Open ${frame.name}`);
        button.innerHTML = `<img src="${frame.url}" alt=""><span>${String(index + 1).padStart(2, "0")}</span>`;
        button.addEventListener("click", () => selectFrame(index));
        list.appendChild(button);
    });
}

function updateImageBadge() {
    if (!state.sourceImage) return;
    const rect = canvas.getBoundingClientRect();
    const zoom = Math.max(1, Math.round((rect.width / state.sourceWidth) * 100));
    const label = state.compare ? "ORIGINAL SIGNAL" : state.preset.name.toUpperCase();
    $("image-badge").textContent = `${label} · ${zoom}%`;
    $("zoom-label").textContent = `${Math.abs(state.zoom - 1) < 0.001 ? "FIT" : "ZOOM"} / ${zoom}%`;
}

function fitCanvasSize() {
    const stage = $("drop-zone");
    const style = getComputedStyle(stage);
    const availableWidth = Math.max(1, stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    const availableHeight = Math.max(1, stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    const aspect = state.sourceWidth / Math.max(1, state.sourceHeight);
    let width = availableWidth;
    let height = width / aspect;
    if (height > availableHeight) {
        height = availableHeight;
        width = height * aspect;
    }
    return { width, height, availableWidth, availableHeight };
}

function loadFullResolutionSource() {
    if (!state.sourceImage) return;
    state.renderToken += 1;
    canvas.width = state.sourceWidth;
    canvas.height = state.sourceHeight;
    context.drawImage(state.sourceImage, 0, 0, state.sourceWidth, state.sourceHeight);
    state.sourcePixels = context.getImageData(0, 0, state.sourceWidth, state.sourceHeight);
    state.grainField = null;
    queueRender();
}

function clampCanvasPan(fit = fitCanvasSize()) {
    const displayWidth = fit.width * state.zoom;
    const displayHeight = fit.height * state.zoom;
    const maximumX = panAxisLimit(displayWidth, fit.availableWidth);
    const maximumY = panAxisLimit(displayHeight, fit.availableHeight);
    state.panX = Math.max(-maximumX, Math.min(maximumX, state.panX));
    state.panY = Math.max(-maximumY, Math.min(maximumY, state.panY));
}

function panAxisLimit(displaySize, viewportSize) {
    const overflow = Math.max(0, displaySize - viewportSize);
    if (overflow <= 0) return 0;
    const edgeAligned = overflow / 2;
    const inspectionOverscroll = Math.min(
        edgeAligned,
        Math.max(0, viewportSize / 2 - 32),
    );
    return edgeAligned + inspectionOverscroll;
}

function applyZoom() {
    if (!state.sourceImage) return;
    const fit = fitCanvasSize();
    clampCanvasPan(fit);
    const frame = $("canvas-frame");
    frame.style.width = `${fit.width * state.zoom}px`;
    frame.style.height = `${fit.height * state.zoom}px`;
    frame.style.transform = `translate(calc(-50% + ${state.panX}px), calc(-50% + ${state.panY}px))`;
    const isFit = Math.abs(state.zoom - 1) < 0.001 && Math.abs(state.panX) < 0.5 && Math.abs(state.panY) < 0.5;
    $("fit-button").setAttribute("aria-pressed", String(isFit));
    updatePanCursor();
    updateImageBadge();
}

function resetZoom() {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    applyZoom();
    setConsole("view fitted to workspace");
}

function setZoomAt(clientX, clientY, nextZoom) {
    const stage = $("drop-zone");
    const stageRect = stage.getBoundingClientRect();
    const frameRect = $("canvas-frame").getBoundingClientRect();
    const fit = fitCanvasSize();
    const centerX = stageRect.left + stageRect.width / 2;
    const centerY = stageRect.top + stageRect.height / 2;
    const anchorX = Math.max(0, Math.min(1, (clientX - frameRect.left) / Math.max(1, frameRect.width)));
    const anchorY = Math.max(0, Math.min(1, (clientY - frameRect.top) / Math.max(1, frameRect.height)));
    nextZoom = Math.max(1, Math.min(8, nextZoom));
    const nextWidth = fit.width * nextZoom;
    const nextHeight = fit.height * nextZoom;
    state.panX = clientX - centerX - (anchorX - 0.5) * nextWidth;
    state.panY = clientY - centerY - (anchorY - 0.5) * nextHeight;
    state.zoom = nextZoom;
    applyZoom();
    setConsole(`view zoom ${Math.round(state.zoom * 100)}% of fit`);
}

function zoomPhotoAt(event) {
    if (!state.sourceImage) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1);
    setZoomAt(event.clientX, event.clientY, state.zoom * Math.exp(-delta * 0.0015));
}

function toggleDetailZoom(event) {
    if (!state.sourceImage || state.view === "crop") return;
    event.preventDefault();
    if (state.zoom > 1.05) resetZoom();
    else setZoomAt(event.clientX, event.clientY, 2);
}

function updatePanCursor() {
    const stage = $("drop-zone");
    stage.classList.toggle("can-pan", Boolean(state.sourceImage) && state.zoom > 1.001 && state.view !== "crop");
    stage.classList.toggle("is-space-pan", state.spaceHeld && !panGesture);
}

function beginPan(event) {
    if (event.button !== 0 || !state.sourceImage) return false;
    if (!state.spaceHeld && (state.zoom <= 1.001 || state.view === "crop")) return false;
    panGesture = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        panX: state.panX,
        panY: state.panY,
    };
    $("drop-zone").setPointerCapture?.(event.pointerId);
    $("drop-zone").classList.add("is-panning");
    event.preventDefault();
    return true;
}

function updatePan(event) {
    if (!panGesture || event.pointerId !== panGesture.pointerId) return;
    state.panX = panGesture.panX + event.clientX - panGesture.clientX;
    state.panY = panGesture.panY + event.clientY - panGesture.clientY;
    applyZoom();
}

function endPan(event) {
    if (!panGesture || (event && event.pointerId !== panGesture.pointerId)) return;
    panGesture = null;
    $("drop-zone").classList.remove("is-panning");
    updatePanCursor();
}

function syncCropUi() {
    const isCrop = state.view === "crop";
    $("develop-tab").classList.toggle("is-active", !isCrop);
    $("develop-tab").setAttribute("aria-selected", String(!isCrop));
    $("crop-tab").classList.toggle("is-active", isCrop);
    $("crop-tab").setAttribute("aria-selected", String(isCrop));
    $("crop-tools").hidden = !isCrop;
    $("crop-overlay").hidden = !isCrop;
    const selection = $("crop-selection");
    selection.style.left = `${state.crop.x * 100}%`;
    selection.style.top = `${state.crop.y * 100}%`;
    selection.style.width = `${state.crop.width * 100}%`;
    selection.style.height = `${state.crop.height * 100}%`;
    const croppedWidth = Math.max(1, Math.round(state.sourceWidth * state.crop.width));
    const croppedHeight = Math.max(1, Math.round(state.sourceHeight * state.crop.height));
    $("crop-dimensions").textContent = `${croppedWidth} × ${croppedHeight}`;
    document.querySelectorAll("[data-crop-aspect]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.cropAspect === state.cropAspect);
    });
    updatePanCursor();
}

function setEditorView(view) {
    state.view = view;
    if (view === "crop") setCompare(false);
    syncCropUi();
    setConsole(`${view} workspace active`);
}

function applyCropAspect(aspect) {
    if (state.cropAspect === aspect) return;
    snapshotHistory(`Crop · ${aspect === "square" ? "1:1" : aspect}`);
    state.cropAspect = aspect;
    if (aspect !== "free") {
        const targetRatio = aspect === "square" ? state.sourceHeight / state.sourceWidth : 1;
        const centerX = state.crop.x + state.crop.width / 2;
        const centerY = state.crop.y + state.crop.height / 2;
        let width = state.crop.width;
        let height = state.crop.height;
        if (width / height > targetRatio) width = height * targetRatio;
        else height = width / targetRatio;
        state.crop = {
            x: Math.max(0, Math.min(1 - width, centerX - width / 2)),
            y: Math.max(0, Math.min(1 - height, centerY - height / 2)),
            width,
            height,
        };
    }
    syncCropUi();
}

function resetCrop() {
    if (JSON.stringify(state.crop) === JSON.stringify(DEFAULT_CROP) && state.cropAspect === "free") return;
    snapshotHistory("Crop · Reset");
    state.crop = { ...DEFAULT_CROP };
    state.cropAspect = "free";
    syncCropUi();
    setConsole("crop reset to full frame");
}

function beginCrop(event) {
    if (state.view !== "crop" || state.spaceHeld || event.button !== 0) return false;
    const selection = event.target.closest("#crop-selection");
    if (!selection) return false;
    cropGesture = {
        pointerId: event.pointerId,
        handle: event.target.dataset.cropHandle || "move",
        clientX: event.clientX,
        clientY: event.clientY,
        crop: { ...state.crop },
        recorded: false,
    };
    $("drop-zone").setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return true;
}

function updateCrop(event) {
    if (!cropGesture || event.pointerId !== cropGesture.pointerId) return;
    const rect = $("canvas-frame").getBoundingClientRect();
    const dx = (event.clientX - cropGesture.clientX) / Math.max(1, rect.width);
    const dy = (event.clientY - cropGesture.clientY) / Math.max(1, rect.height);
    if (!cropGesture.recorded) {
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
        snapshotHistory("Crop · Adjust");
        cropGesture.recorded = true;
    }
    const start = cropGesture.crop;
    const minimum = 0.04;
    if (cropGesture.handle === "move") {
        state.crop.x = Math.max(0, Math.min(1 - start.width, start.x + dx));
        state.crop.y = Math.max(0, Math.min(1 - start.height, start.y + dy));
        syncCropUi();
        return;
    }

    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;
    const handle = cropGesture.handle;
    if (handle.includes("w")) left = Math.min(right - minimum, Math.max(0, left + dx));
    if (handle.includes("e")) right = Math.max(left + minimum, Math.min(1, right + dx));
    if (handle.includes("n")) top = Math.min(bottom - minimum, Math.max(0, top + dy));
    if (handle.includes("s")) bottom = Math.max(top + minimum, Math.min(1, bottom + dy));

    if (state.cropAspect !== "free" && handle.length === 2) {
        const targetRatio = state.cropAspect === "square" ? state.sourceHeight / state.sourceWidth : 1;
        let width = right - left;
        let height = bottom - top;
        if (width / height > targetRatio) height = width / targetRatio;
        else width = height * targetRatio;
        width = Math.min(width, handle.includes("w") ? right : 1 - left);
        height = width / targetRatio;
        if (height > (handle.includes("n") ? bottom : 1 - top)) {
            height = handle.includes("n") ? bottom : 1 - top;
            width = height * targetRatio;
        }
        if (handle.includes("w")) left = right - width;
        else right = left + width;
        if (handle.includes("n")) top = bottom - height;
        else bottom = top + height;
    } else if (state.cropAspect !== "free") {
        state.cropAspect = "free";
    }
    state.crop = { x: left, y: top, width: right - left, height: bottom - top };
    syncCropUi();
}

function endCrop(event) {
    if (!cropGesture || (event && event.pointerId !== cropGesture.pointerId)) return;
    cropGesture = null;
    setConsole("crop boundary updated");
}

function setCompare(active) {
    if (state.compare === active) return;
    state.compare = active;
    $("before-button").setAttribute("aria-pressed", String(active));
    queueRender();
    setConsole(active ? "showing original signal" : `developed with ${state.preset.name.toLowerCase()}`);
}

function toggleGrid() {
    state.grid = !state.grid;
    $("crop-grid").hidden = !state.grid;
    $("grid-button").setAttribute("aria-pressed", String(state.grid));
    setConsole(`composition grid ${state.grid ? "enabled" : "disabled"}`);
}

function toggleOverlay(show = $("command-overlay").hidden) {
    $("command-overlay").hidden = !show;
    if (show) $("close-overlay").focus();
}

function setConsole(message) {
    $("console-status").textContent = message;
}

function showToast(message) {
    clearTimeout(toastTimer);
    const toast = $("toast");
    toast.textContent = `> ${message}`;
    toast.hidden = false;
    toastTimer = setTimeout(() => {
        toast.hidden = true;
    }, 2600);
}

function bindNativeWindowDragging() {
    const titlebar = $("titlebar");
    const tauriWindow = window.__TAURI__?.window;
    if (!titlebar || !tauriWindow?.getCurrentWindow) return;

    const appWindow = tauriWindow.getCurrentWindow();
    titlebar.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button, input, select, textarea, a, [contenteditable='true']")) return;
        event.preventDefault();
        appWindow.startDragging().catch((error) => {
            console.error("Unable to start native window drag.", error);
        });
    });
}

async function exportFrame() {
    if (!state.sourceImage) return;
    setConsole("rendering export buffer…");
    const sourceX = Math.round(state.sourceWidth * state.crop.x);
    const sourceY = Math.round(state.sourceHeight * state.crop.y);
    const sourceCropWidth = Math.max(1, Math.round(state.sourceWidth * state.crop.width));
    const sourceCropHeight = Math.max(1, Math.round(state.sourceHeight * state.crop.height));
    const maxEdge = 4096;
    const scale = Math.min(1, maxEdge / Math.max(sourceCropWidth, sourceCropHeight));
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.max(1, Math.round(sourceCropWidth * scale));
    exportCanvas.height = Math.max(1, Math.round(sourceCropHeight * scale));
    const exportContext = exportCanvas.getContext("2d", { willReadFrequently: true });
    exportContext.drawImage(
        state.sourceImage,
        sourceX,
        sourceY,
        sourceCropWidth,
        sourceCropHeight,
        0,
        0,
        exportCanvas.width,
        exportCanvas.height,
    );
    const source = exportContext.getImageData(0, 0, exportCanvas.width, exportCanvas.height);
    const developed = await renderWithBestEngine(source, combinedSettings(), false, null);
    exportContext.putImageData(developed, 0, 0);
    const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/jpeg", 0.94));
    if (!blob) {
        showToast("EXPORT FAILED · unable to encode frame");
        return;
    }
    const frame = state.frames[state.activeFrame];
    const baseName = frame.name.replace(/\.[^.]+$/, "") || "grainlab-frame";
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `${baseName}-${state.preset.id}.jpg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setConsole(`exported ${link.download}`);
    showToast(`EXPORTED · ${link.download}`);
}

function bindEvents() {
    bindNativeWindowDragging();
    $("open-button").addEventListener("click", () => $("file-input").click());
    $("add-frame-button").addEventListener("click", () => $("file-input").click());
    $("add-folder-button").addEventListener("click", () => $("directory-input").click());
    $("file-input").addEventListener("change", (event) => {
        addFiles(event.target.files);
        event.target.value = "";
    });
    $("directory-input").addEventListener("change", (event) => {
        addFiles(event.target.files);
        event.target.value = "";
    });
    $("export-button").addEventListener("click", exportFrame);
    $("undo-button").addEventListener("click", undo);
    $("reset-button").addEventListener("click", resetFrame);
    $("grid-button").addEventListener("click", toggleGrid);
    $("fit-button").addEventListener("click", resetZoom);
    $("shortcut-button").addEventListener("click", () => toggleOverlay(true));
    $("close-overlay").addEventListener("click", () => toggleOverlay(false));
    $("command-overlay").addEventListener("click", (event) => {
        if (event.target === $("command-overlay")) toggleOverlay(false);
    });
    $("close-stock-overlay").addEventListener("click", closeStockDossier);
    $("stock-overlay").addEventListener("click", (event) => {
        if (event.target === $("stock-overlay")) closeStockDossier();
    });
    $("stock-dossier-content").addEventListener("click", (event) => {
        const source = event.target.closest("[data-source-url]");
        if (source) copySourceUrl(source.dataset.sourceUrl);
    });

    const beforeButton = $("before-button");
    beforeButton.addEventListener("pointerdown", () => setCompare(true));
    beforeButton.addEventListener("pointerup", () => setCompare(false));
    beforeButton.addEventListener("pointerleave", () => setCompare(false));
    beforeButton.addEventListener("pointercancel", () => setCompare(false));

    $("develop-tab").addEventListener("click", () => setEditorView("develop"));
    $("crop-tab").addEventListener("click", () => setEditorView("crop"));
    document.querySelectorAll("[data-crop-aspect]").forEach((button) => {
        button.addEventListener("click", () => applyCropAspect(button.dataset.cropAspect));
    });
    $("crop-reset-button").addEventListener("click", resetCrop);
    $("crop-done-button").addEventListener("click", () => setEditorView("develop"));

    $("preset-search").addEventListener("input", (event) => {
        state.search = event.target.value;
        renderPresetList();
    });

    $("filter-tabs").addEventListener("click", (event) => {
        const button = event.target.closest("[data-filter]");
        if (!button) return;
        state.filter = button.dataset.filter;
        document.querySelectorAll(".filter-tab").forEach((tab) => {
            const active = tab === button;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
        });
        renderPresetList();
    });

    $("process-filter").addEventListener("change", (event) => {
        state.processFilter = event.target.value;
        renderPresetList();
    });

    document.querySelectorAll("[data-reset-group]").forEach((button) => {
        button.addEventListener("click", () => resetGroup(button.dataset.resetGroup));
    });

    const dropZone = $("drop-zone");
    dropZone.addEventListener("wheel", zoomPhotoAt, { passive: false });
    dropZone.addEventListener("dblclick", toggleDetailZoom);
    dropZone.addEventListener("pointerdown", (event) => {
        if (beginCrop(event)) return;
        beginPan(event);
    });
    dropZone.addEventListener("pointermove", (event) => {
        updateCrop(event);
        updatePan(event);
    });
    dropZone.addEventListener("pointerup", (event) => {
        endCrop(event);
        endPan(event);
    });
    dropZone.addEventListener("pointercancel", (event) => {
        endCrop(event);
        endPan(event);
    });
    let dragDepth = 0;
    window.addEventListener("dragenter", (event) => {
        event.preventDefault();
        dragDepth += 1;
        dropZone.classList.add("is-dragging");
    });
    window.addEventListener("dragleave", (event) => {
        event.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) dropZone.classList.remove("is-dragging");
    });
    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", (event) => {
        event.preventDefault();
        dragDepth = 0;
        dropZone.classList.remove("is-dragging");
        addFiles(event.dataTransfer.files);
    });
    window.addEventListener("paste", (event) => {
        const files = [...event.clipboardData.items]
            .filter((item) => item.type.startsWith("image/"))
            .map((item) => item.getAsFile())
            .filter(Boolean);
        if (files.length) addFiles(files);
    });

    window.addEventListener("keydown", (event) => {
        const editingText = event.target.matches("input, textarea, select, [contenteditable='true']");
        if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "o") {
            event.preventDefault();
            $("directory-input").click();
        } else if (event.metaKey && event.key.toLowerCase() === "o") {
            event.preventDefault();
            $("file-input").click();
        } else if (event.metaKey && event.key.toLowerCase() === "e") {
            event.preventDefault();
            exportFrame();
        } else if (event.metaKey && event.key.toLowerCase() === "z") {
            event.preventDefault();
            undo();
        } else if (event.metaKey && event.key.toLowerCase() === "k") {
            event.preventDefault();
            toggleOverlay();
        } else if (event.metaKey && event.key === "/") {
            event.preventDefault();
            $("preset-search").focus();
            $("preset-search").select();
        } else if (event.key === "Escape") {
            closeStockDossier();
            toggleOverlay(false);
            $("preset-search").blur();
        } else if (!editingText && event.code === "Space") {
            event.preventDefault();
            state.spaceHeld = true;
            updatePanCursor();
        } else if (!editingText && event.key.toLowerCase() === "b") {
            event.preventDefault();
            setCompare(true);
        } else if (!editingText && event.key.toLowerCase() === "g") {
            event.preventDefault();
            toggleGrid();
        } else if (!editingText && event.key.toLowerCase() === "i") {
            event.preventDefault();
            openStockDossier();
        } else if (!editingText && event.key === "ArrowDown") {
            event.preventDefault();
            selectPresetByOffset(1);
        } else if (!editingText && event.key === "ArrowUp") {
            event.preventDefault();
            selectPresetByOffset(-1);
        }
    });
    window.addEventListener("keyup", (event) => {
        if (event.key.toLowerCase() === "b") setCompare(false);
        if (event.code === "Space") {
            state.spaceHeld = false;
            updatePanCursor();
        }
    });
    window.addEventListener("blur", () => {
        setCompare(false);
        state.spaceHeld = false;
        endPan();
        endCrop();
    });
    window.addEventListener("resize", applyZoom);
}

async function initializeRenderer() {
    const available = await gpuProcessor.initialize();
    $("render-engine").textContent = available ? "WGSL / GPU" : "CPU / SAFE";
}

async function initialize() {
    PRESETS = await loadFilmStocks();
    state.preset = PRESETS.find((preset) => preset.id === "tungsten") || PRESETS[0];
    buildControls();
    bindEvents();
    initializeRenderer();
    state.frames.push({
        name: "coast-at-blue-hour.png",
        url: "assets/demo-coast.png",
        revoke: false,
        editState: createDefaultEditState(state.preset.id),
    });
    renderFrameList();
    await selectFrame(0);
    setConsole("demo frame loaded · select a stock or drop a photo");
}

initialize().catch((error) => {
    console.error(error);
    setConsole("unable to initialize image engine");
    showToast("ENGINE ERROR · reload the workspace");
});
