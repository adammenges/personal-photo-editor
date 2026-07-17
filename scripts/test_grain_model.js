"use strict";

const assert = require("node:assert/strict");

require("../ui/grain.js");

const { createEmulsionGrainSampler, createFilmGrainField } = globalThis.GrainlabGrain;
const width = 64;
const height = 64;
const seed = 0x5eed1234;
const field = createFilmGrainField(width, height, seed);
const detail = { meanRadius: 0.8, radiusVariance: 0.24, shadowBias: 0.45, chroma: 0.04 };
const dyeProfile = {
    medium: "dye",
    crystal: "tabular",
    emulsion: "mixed",
    scale: "medium",
    process: "standard",
};
const silverProfile = { ...dyeProfile, medium: "silver" };

assert.equal(createEmulsionGrainSampler(width, height, field, 0, dyeProfile, detail), null);

const dyeSampler = createEmulsionGrainSampler(width, height, field, 13, dyeProfile, detail);
const silverSampler = createEmulsionGrainSampler(width, height, field, 13, silverProfile, detail);
const output = new Float32Array(6);

function standardDeviation(values) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function correlation(first, second) {
    const firstMean = first.reduce((sum, value) => sum + value, 0) / first.length;
    const secondMean = second.reduce((sum, value) => sum + value, 0) / second.length;
    let covariance = 0;
    let firstEnergy = 0;
    let secondEnergy = 0;
    for (let index = 0; index < first.length; index += 1) {
        const firstDelta = first[index] - firstMean;
        const secondDelta = second[index] - secondMean;
        covariance += firstDelta * secondDelta;
        firstEnergy += firstDelta * firstDelta;
        secondEnergy += secondDelta * secondDelta;
    }
    return covariance / Math.sqrt(firstEnergy * secondEnergy);
}

function grainDeviation(exposure) {
    const exposureValues = [];
    const activationValues = [];
    const activation = exposure / (exposure + 0.18);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            dyeSampler.sample(x, y, exposure, exposure, exposure, output);
            exposureValues.push(Math.log(output[0] / exposure));
            activationValues.push(output[0] / (output[0] + 0.18) - activation);
        }
    }
    return {
        exposure: standardDeviation(exposureValues),
        activation: standardDeviation(activationValues),
    };
}

// Boolean crystal activation has its greatest absolute variance near p=0.5,
// while sparse shadow exposure carries the greatest relative uncertainty.
const shadowDeviation = grainDeviation(0.02);
const middleDeviation = grainDeviation(0.18);
const highlightDeviation = grainDeviation(0.8);
assert(middleDeviation.activation > shadowDeviation.activation * 1.3);
assert(middleDeviation.activation > highlightDeviation.activation * 1.2);
assert(shadowDeviation.exposure > highlightDeviation.exposure * 1.3);

// The same frame, seed, coordinate, and signal must always produce the same emulsion.
const first = new Float32Array(6);
const second = new Float32Array(6);
dyeSampler.sample(17, 23, 0.12, 0.24, 0.48, first);
dyeSampler.sample(17, 23, 0.12, 0.24, 0.48, second);
assert.deepEqual(first, second);

// Strength reveals more of the same fixed dye-cloud field. It must not alter
// the chroma mixture and replace the pattern while a slider is being dragged.
const strongSampler = createEmulsionGrainSampler(width, height, field, 31, dyeProfile, detail);
const normalStrength = new Float32Array(6);
const strongStrength = new Float32Array(6);
for (const [x, y] of [[3, 5], [17, 23], [41, 12], [62, 57]]) {
    dyeSampler.sample(x, y, 0, 0, 0, normalStrength);
    strongSampler.sample(x, y, 0, 0, 0, strongStrength);
    for (let channel = 3; channel < 6; channel += 1) {
        assert(Math.abs(normalStrength[channel] / 13 - strongStrength[channel] / 31) < 1e-9);
    }
}

// Apparent radius crossfades anchored crystal populations. Widely separated
// radius settings should remain strongly correlated instead of spatially warping.
const fineRadiusSampler = createEmulsionGrainSampler(
    width, height, field, 13, dyeProfile, { ...detail, meanRadius: 0.45 },
);
const coarseRadiusSampler = createEmulsionGrainSampler(
    width, height, field, 13, dyeProfile, { ...detail, meanRadius: 1.8 },
);
const finePattern = [];
const coarsePattern = [];
for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
        fineRadiusSampler.sample(x, y, 0, 0, 0, first);
        coarseRadiusSampler.sample(x, y, 0, 0, 0, second);
        finePattern.push(first[3]);
        coarsePattern.push(second[3]);
    }
}
assert(correlation(finePattern, coarsePattern) > 0.85);

// Silver is one neutral image-forming structure: its exposure modulation must
// preserve channel ratios even if it is applied over a color record.
silverSampler.sample(31, 9, 0.1, 0.2, 0.4, output);
const redMultiplier = output[0] / 0.1;
const greenMultiplier = output[1] / 0.2;
const blueMultiplier = output[2] / 0.4;
assert(Math.abs(redMultiplier - greenMultiplier) < 1e-6);
assert(Math.abs(greenMultiplier - blueMultiplier) < 1e-6);

// A developed-density floor keeps a stochastic structure in unexposed areas;
// it remains upstream of chemistry and encoding rather than becoming RGB noise.
dyeSampler.sample(11, 37, 0, 0, 0, output);
assert.equal(output[0], 0);
assert.equal(output[1], 0);
assert.equal(output[2], 0);
assert(output[3] !== 0 || output[4] !== 0 || output[5] !== 0);

console.log("grain model regression checks passed");
