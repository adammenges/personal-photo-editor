(function installFilmGrain(root) {
    "use strict";

    const UINT32_RANGE = 4294967296;
    const SQRT_THREE = Math.sqrt(3);

    function hash32(x, y, seed, lane) {
        let value = Math.imul(x | 0, 0x1f123bb5)
            ^ Math.imul(y | 0, 0x5f356495)
            ^ Math.imul(seed | 0, 0x6c8e9cf5)
            ^ Math.imul(lane | 0, 0x27d4eb2d);
        value ^= value >>> 16;
        value = Math.imul(value, 0x7feb352d);
        value ^= value >>> 15;
        value = Math.imul(value, 0x846ca68b);
        value ^= value >>> 16;
        return (value >>> 0) / UINT32_RANGE;
    }

    // Four independent uniform samples approximate a unit Gaussian without
    // introducing the short spatial period of a lookup texture or modulo tile.
    function gaussianSample(x, y, seed) {
        const sum = hash32(x, y, seed, 0)
            + hash32(x, y, seed, 1)
            + hash32(x, y, seed, 2)
            + hash32(x, y, seed, 3);
        return (sum - 2) * SQRT_THREE;
    }

    function gaussianPlane(width, height, seed) {
        const values = new Float32Array(width * height);
        for (let y = 0; y < height; y += 1) {
            const row = y * width;
            for (let x = 0; x < width; x += 1) {
                values[row + x] = gaussianSample(x, y, seed);
            }
        }
        return values;
    }

    // A compact Gaussian approximation models grain clumping plus the optical
    // filtering introduced by emulsion thickness, enlargement, scanning, and vision.
    function blurPlane(source, width, height) {
        const horizontal = new Float32Array(source.length);
        const output = new Float32Array(source.length);

        for (let y = 0; y < height; y += 1) {
            const row = y * width;
            for (let x = 0; x < width; x += 1) {
                const left = row + Math.max(0, x - 1);
                const center = row + x;
                const right = row + Math.min(width - 1, x + 1);
                horizontal[center] = source[left] * 0.25 + source[center] * 0.5 + source[right] * 0.25;
            }
        }

        for (let y = 0; y < height; y += 1) {
            const previous = Math.max(0, y - 1) * width;
            const row = y * width;
            const next = Math.min(height - 1, y + 1) * width;
            for (let x = 0; x < width; x += 1) {
                output[row + x] = horizontal[previous + x] * 0.25
                    + horizontal[row + x] * 0.5
                    + horizontal[next + x] * 0.25;
            }
        }

        return output;
    }

    function normalizePlane(values) {
        let sum = 0;
        let sumSquares = 0;
        for (let index = 0; index < values.length; index += 1) {
            sum += values[index];
            sumSquares += values[index] * values[index];
        }
        const mean = sum / values.length;
        const variance = Math.max(1e-6, sumSquares / values.length - mean * mean);
        const inverseDeviation = 1 / Math.sqrt(variance);
        for (let index = 0; index < values.length; index += 1) {
            values[index] = (values[index] - mean) * inverseDeviation;
        }
        return values;
    }

    function mixPlanes(first, second, firstWeight, secondWeight) {
        const output = new Float32Array(first.length);
        for (let index = 0; index < output.length; index += 1) {
            output[index] = first[index] * firstWeight + second[index] * secondWeight;
        }
        return normalizePlane(output);
    }

    function hashString(value) {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function createFilmGrainField(width, height, seed = 1, maximumEdge = 1024) {
        const longEdge = Math.max(width, height);
        const scale = Math.min(1, maximumEdge / Math.max(1, longEdge));
        const fieldWidth = Math.max(2, Math.round(width * scale));
        const fieldHeight = Math.max(2, Math.round(height * scale));

        const white = gaussianPlane(fieldWidth, fieldHeight, seed ^ 0x243f6a88);
        const soft = blurPlane(white, fieldWidth, fieldHeight);
        const fine = mixPlanes(white, soft, 0.65, 0.35);
        const coarse = normalizePlane(blurPlane(blurPlane(soft, fieldWidth, fieldHeight), fieldWidth, fieldHeight));

        const redWhite = gaussianPlane(fieldWidth, fieldHeight, seed ^ 0x85a308d3);
        const blueWhite = gaussianPlane(fieldWidth, fieldHeight, seed ^ 0x13198a2e);
        const redLayer = normalizePlane(blurPlane(redWhite, fieldWidth, fieldHeight));
        const blueLayer = normalizePlane(blurPlane(blueWhite, fieldWidth, fieldHeight));

        return {
            width: fieldWidth,
            height: fieldHeight,
            sharp: white,
            fine,
            soft,
            coarse,
            redLayer,
            blueLayer,
            seed: seed >>> 0,
        };
    }

    function createAxisMap(outputLength, fieldLength) {
        const low = new Uint32Array(outputLength);
        const high = new Uint32Array(outputLength);
        const blend = new Float32Array(outputLength);
        const denominator = Math.max(1, outputLength - 1);
        for (let coordinate = 0; coordinate < outputLength; coordinate += 1) {
            const fieldCoordinate = coordinate * (fieldLength - 1) / denominator;
            const base = Math.floor(fieldCoordinate);
            low[coordinate] = base;
            high[coordinate] = Math.min(fieldLength - 1, base + 1);
            blend[coordinate] = fieldCoordinate - base;
        }
        return { low, high, blend };
    }

    function bilinear(values, width, x0, x1, tx, y0, y1, ty) {
        const top = values[y0 * width + x0] * (1 - tx) + values[y0 * width + x1] * tx;
        const bottom = values[y1 * width + x0] * (1 - tx) + values[y1 * width + x1] * tx;
        return top * (1 - ty) + bottom * ty;
    }

    const ACTIVATION_MIDPOINT = 0.18;

    function activationProbability(exposure) {
        const bounded = Math.max(0, exposure);
        return bounded / (bounded + ACTIVATION_MIDPOINT);
    }

    function relativeLuminance(red, green, blue) {
        return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    }

    function activationVariance(activation) {
        return Math.sqrt(Math.max(0, 4 * activation * (1 - activation)));
    }

    function modulateExposure(exposure, noise, amplitude) {
        if (exposure <= 0 || amplitude <= 0) return Math.max(0, exposure);
        const activation = activationProbability(exposure);
        const stochasticActivation = Math.max(0, Math.min(
            0.997,
            activation + noise * amplitude * activationVariance(activation),
        ));
        return ACTIVATION_MIDPOINT * stochasticActivation / (1 - stochasticActivation);
    }

    // Grain is sampled as part of image formation, not applied to encoded RGB.
    // The first three output values are stochastic scene exposures that will enter
    // the film curve; the last three are a small developed-density floor added just
    // after that curve. Reusing one output array avoids per-pixel allocations.
    function createEmulsionGrainSampler(width, height, field, intensity, profile = {}, detail = {}) {
        const strength = Math.max(0, Math.min(64, intensity));
        if (!field || strength <= 0) return null;

        const resolved = {
            medium: profile.medium || "dye",
            crystal: profile.crystal || "tabular",
            emulsion: profile.emulsion || "mixed",
            scale: profile.scale || "medium",
            process: profile.process || "standard",
        };
        const crystalModels = {
            cubic: { sharp: 0.32, fine: 0.28, soft: 0.12, coarse: 0.28, amplitude: 1.14, tail: 1.12 },
            tabular: { sharp: 0.44, fine: 0.42, soft: 0.10, coarse: 0.04, amplitude: 0.82, tail: 1.0 },
            delta: { sharp: 0.16, fine: 0.46, soft: 0.32, coarse: 0.06, amplitude: 0.78, tail: 0.96 },
        };
        const model = { ...(crystalModels[resolved.crystal] || crystalModels.tabular) };
        const radius = Math.max(0.2, Math.min(2.5, detail.meanRadius ?? 0.8));
        const radiusVariance = Math.max(0, Math.min(1.5, detail.radiusVariance ?? 0.1));
        const shadowBias = Math.max(0, Math.min(1.5, detail.shadowBias ?? 0.1));

        if (resolved.medium === "dye") {
            model.soft *= 1.18;
            model.amplitude *= 0.92;
        } else {
            model.sharp *= 1.12;
            model.amplitude *= 1.06;
        }
        if (resolved.emulsion === "uniform") {
            model.coarse *= 0.72;
            model.amplitude *= 0.92;
        } else if (resolved.emulsion === "core-shell") {
            model.coarse *= 0.82;
            model.amplitude *= 0.78;
        }
        if (resolved.scale === "fine") {
            model.sharp *= 1.18;
            model.fine *= 1.18;
            model.coarse *= 0.34;
            model.amplitude *= 0.70;
        } else if (resolved.scale === "coarse") {
            model.sharp *= 0.66;
            model.soft *= 1.28;
            model.coarse *= 1.72;
            model.amplitude *= 1.34;
        }
        if (resolved.process === "push") {
            model.coarse *= 1.36;
            model.amplitude *= 1.32;
            model.tail = Math.max(model.tail, 1.16);
        } else if (resolved.process === "motion") {
            model.fine *= 1.14;
            model.soft *= 1.22;
            model.coarse *= 0.82;
            model.amplitude *= 0.84;
        } else if (resolved.process === "pull") {
            model.coarse *= 0.72;
            model.amplitude *= 0.84;
        } else if (resolved.process === "bleach") {
            model.sharp *= 1.16;
            model.amplitude *= 1.18;
        } else if (resolved.process === "cross") {
            model.coarse *= 1.10;
            model.amplitude *= 1.10;
        }

        const radiusScale = Math.max(0.45, Math.min(2.4, radius / 0.8));
        if (radiusScale > 1) {
            model.sharp /= radiusScale;
            model.fine /= Math.sqrt(radiusScale);
            model.soft *= Math.sqrt(radiusScale);
            model.coarse *= radiusScale;
        } else {
            model.sharp *= 1 / radiusScale;
            model.fine *= 1 / Math.sqrt(radiusScale);
            model.coarse *= radiusScale;
        }
        model.coarse *= 1 + radiusVariance * 0.65;

        const xMap = createAxisMap(width, field.width);
        const yMap = createAxisMap(height, field.height);
        let chromaWeight = resolved.medium === "silver"
            ? 0
            : Math.max(0, Math.min(0.16, detail.chroma ?? 0.035));
        if (resolved.process === "motion") chromaWeight *= 0.7;
        if (resolved.process === "cross") chromaWeight *= 1.35;
        const exposureAmplitude = strength * 0.00085 * model.amplitude;
        const densityFloorAmplitude = strength * 0.000035 * model.amplitude;

        function sample(x, y, red, green, blue, output) {
            const y0 = yMap.low[y];
            const y1 = yMap.high[y];
            const ty = yMap.blend[y];
            const x0 = xMap.low[x];
            const x1 = xMap.high[x];
            const tx = xMap.blend[x];

            const sharp = bilinear(field.sharp, field.width, x0, x1, tx, y0, y1, ty);
            const fine = bilinear(field.fine, field.width, x0, x1, tx, y0, y1, ty);
            const soft = bilinear(field.soft, field.width, x0, x1, tx, y0, y1, ty);
            const coarse = bilinear(field.coarse, field.width, x0, x1, tx, y0, y1, ty);
            const redActivation = activationProbability(red);
            const greenActivation = activationProbability(green);
            const blueActivation = activationProbability(blue);
            const activation = Math.max(0, Math.min(1,
                relativeLuminance(redActivation, greenActivation, blueActivation)));

            let coarseWeight = model.coarse;
            if (resolved.emulsion === "mixed") coarseWeight *= 1 + (1 - activation) * 0.62;
            const energyCorrection = 1 / Math.sqrt(
                model.sharp ** 2 + model.fine ** 2 + model.soft ** 2 + coarseWeight ** 2,
            );
            let baseNoise = (
                sharp * model.sharp
                + fine * model.fine
                + soft * model.soft
                + coarse * coarseWeight
            ) * energyCorrection;
            if (model.tail !== 1) {
                baseNoise = Math.sign(baseNoise) * Math.abs(baseNoise) ** model.tail;
            }

            let processScale = 1;
            if (resolved.emulsion === "core-shell") processScale *= 0.72 + activation * 0.28;
            if (resolved.process === "push") processScale *= 1 + (1 - activation) * 0.30;
            const shadowScale = (1 + (1 - activation) * shadowBias * 0.55) * processScale;

            let redNoise = baseNoise;
            let greenNoise = baseNoise;
            let blueNoise = baseNoise;
            if (resolved.medium !== "silver") {
                const redLayer = bilinear(field.redLayer, field.width, x0, x1, tx, y0, y1, ty);
                const blueLayer = bilinear(field.blueLayer, field.width, x0, x1, tx, y0, y1, ty);
                const shadowChroma = Math.min(0.18, chromaWeight * (1 + (1 - activation) * 0.65));
                // Keep the shared dye-cloud structure at a fixed spatial phase.
                // Chroma is a weak opponent residual revealed around it, not a
                // crossfade that replaces one grain pattern as strength changes.
                redNoise = baseNoise + redLayer * shadowChroma;
                greenNoise = baseNoise
                    - (redLayer * 0.2973 + blueLayer * 0.1009) * shadowChroma;
                blueNoise = baseNoise + blueLayer * shadowChroma;
            }

            if (resolved.medium === "silver") {
                const neutralExposure = relativeLuminance(red, green, blue);
                const modulatedNeutral = modulateExposure(
                    neutralExposure,
                    baseNoise,
                    exposureAmplitude * shadowScale,
                );
                const multiplier = neutralExposure > 0 ? modulatedNeutral / neutralExposure : 1;
                output[0] = Math.max(0, red) * multiplier;
                output[1] = Math.max(0, green) * multiplier;
                output[2] = Math.max(0, blue) * multiplier;
            } else {
                output[0] = modulateExposure(
                    red,
                    redNoise,
                    exposureAmplitude * shadowScale,
                );
                output[1] = modulateExposure(
                    green,
                    greenNoise,
                    exposureAmplitude * shadowScale,
                );
                output[2] = modulateExposure(
                    blue,
                    blueNoise,
                    exposureAmplitude * shadowScale,
                );
            }

            // A small signed density residual represents fog grains and developed
            // structures that remain visible where multiplicative exposure noise
            // alone would vanish. It is still upstream of chemistry and scan tone.
            const densityFloor = densityFloorAmplitude * (0.72 + (1 - activation) * 0.28) * processScale;
            output[3] = redNoise * densityFloor;
            output[4] = greenNoise * densityFloor;
            output[5] = blueNoise * densityFloor;
        }

        return Object.freeze({ sample });
    }

    root.GrainlabGrain = Object.freeze({
        createEmulsionGrainSampler,
        createFilmGrainField,
        hashString,
    });
})(typeof window === "undefined" ? globalThis : window);
