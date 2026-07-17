"use strict";

const fs = require("node:fs");
const path = require("node:path");

require("../ui/grain.js");

const root = path.resolve(__dirname, "..");
const stock = JSON.parse(fs.readFileSync(
    path.join(root, "ui/film-stocks/canon/usa/kodak-portra-400.json"),
    "utf8",
));
const width = 192;
const height = 192;
const field = globalThis.GrainlabGrain.createFilmGrainField(width, height, 0x5eed1234);
const exposures = Array.from({ length: 16 }, (_, index) => index / 15);
const activationMidpoint = 0.18;

function standardDeviation(values) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

const activationDeviation = exposures.map((exposure) => {
    const sampler = globalThis.GrainlabGrain.createEmulsionGrainSampler(
        width,
        height,
        field,
        stock.settings.grain,
        stock.grainProfile,
        stock.pipeline.grain,
    );
    const baseline = exposure / (exposure + activationMidpoint);
    const sample = new Float32Array(6);
    const deviations = [];
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            sampler.sample(x, y, exposure, exposure, exposure, sample);
            const activation = sample[1] / (sample[1] + activationMidpoint);
            deviations.push(activation - baseline);
        }
    }
    return standardDeviation(deviations);
});

const payload = {
    schemaVersion: 1,
    stockId: stock.id,
    seed: 0x5eed1234,
    dimensions: [width, height],
    exposures,
    activationDeviation,
    note: "Absolute standard deviation of green-record crystal activation for the fixed Portra 400 field.",
};
const destination = path.join(root, "artifacts/visual-tests/model-grain-response.json");
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(payload, null, 2) + "\n");
console.log(`model    ${destination}`);
