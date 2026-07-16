(function installGpuProcessor(root) {
    "use strict";

    const ENUMS = {
        medium: { silver: 0, dye: 1 },
        crystal: { cubic: 0, tabular: 1, delta: 2 },
        emulsion: { uniform: 0, mixed: 1, "core-shell": 2 },
        scale: { fine: 0, medium: 1, coarse: 2 },
        process: { standard: 0, push: 1, motion: 2, pull: 3, bleach: 4, cross: 5 },
        family: { utility: 0, bw: 1, c41: 2, e6: 3, ecn2: 4, print: 5 },
    };

    const PARAMETER_BYTES = 224;

    class WgslPhotoProcessor {
        constructor() {
            this.device = null;
            this.pipeline = null;
            this.initializePromise = null;
            this.available = null;
            this.sourceCache = null;
        }

        async initialize() {
            if (this.initializePromise) return this.initializePromise;
            this.initializePromise = this.initializeInternal();
            return this.initializePromise;
        }

        async initializeInternal() {
            if (!root.navigator?.gpu) {
                this.available = false;
                return false;
            }
            try {
                const adapter = await root.navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
                if (!adapter) throw new Error("No WebGPU adapter available");
                this.device = await adapter.requestDevice();
                const shaderUrl = new URL("shaders/photo.wgsl", root.document.baseURI);
                const shaderCode = await fetch(shaderUrl).then((response) => {
                    if (!response.ok) throw new Error(`Unable to load WGSL shader (${response.status})`);
                    return response.text();
                });
                const module = this.device.createShaderModule({ label: "grainlab-photo-wgsl", code: shaderCode });
                const compilation = typeof module.getCompilationInfo === "function"
                    ? await module.getCompilationInfo()
                    : { messages: [] };
                const errors = compilation.messages.filter((message) => message.type === "error");
                if (errors.length) throw new Error(errors.map((error) => error.message).join("\n"));
                this.pipeline = this.device.createComputePipeline({
                    label: "grainlab-photo-pipeline",
                    layout: "auto",
                    compute: { module, entryPoint: "process_photo" },
                });
                this.device.lost.then(() => {
                    this.available = false;
                    this.device = null;
                    this.pipeline = null;
                    this.initializePromise = null;
                    this.sourceCache = null;
                });
                this.available = true;
                return true;
            } catch (error) {
                console.warn("WGSL renderer unavailable; using CPU fallback.", error);
                this.available = false;
                return false;
            }
        }

        createParams(imageData, settings, seed, showOriginal) {
            const buffer = new ArrayBuffer(PARAMETER_BYTES);
            const view = new DataView(buffer);
            const profile = settings.grainProfile;
            const pipeline = settings.pipeline;
            const floatVector = (offset, values) => values.forEach((value, index) => {
                view.setFloat32(offset + index * 4, value, true);
            });
            view.setUint32(0, imageData.width, true);
            view.setUint32(4, imageData.height, true);
            view.setUint32(8, seed >>> 0, true);
            view.setUint32(12, showOriginal ? 1 : 0, true);
            floatVector(16, [
                2 ** settings.exposure,
                1 + settings.contrast / 100,
                settings.highlights / 100,
                settings.shadows / 100,
            ]);
            floatVector(32, [
                ...settings.whiteBalance,
                Math.max(0, 1 + settings.saturation / 100),
            ]);
            floatVector(48, [settings.fade * 0.0043, settings.vignette / 100, settings.grain, 0]);
            view.setUint32(64, ENUMS.medium[profile.medium] ?? 1, true);
            view.setUint32(68, ENUMS.crystal[profile.crystal] ?? 1, true);
            view.setUint32(72, ENUMS.emulsion[profile.emulsion] ?? 1, true);
            view.setUint32(76, ENUMS.scale[profile.scale] ?? 1, true);
            view.setUint32(80, ENUMS.process[profile.process] ?? 0, true);
            view.setUint32(84, ENUMS.family[pipeline.family] ?? 0, true);
            view.setUint32(88, pipeline.monochrome ? 1 : 0, true);
            view.setUint32(92, 0, true);
            floatVector(96, [...pipeline.scene.sensitivity, pipeline.scene.flash]);
            floatVector(112, [
                pipeline.curve.toe,
                pipeline.curve.shoulder,
                pipeline.curve.gamma,
                pipeline.curve.saturationCompression,
            ]);
            floatVector(128, [...pipeline.crossover.shadows, 0]);
            floatVector(144, [...pipeline.crossover.highlights, 0]);
            floatVector(160, [
                pipeline.chemistry.silverRetention,
                pipeline.chemistry.fog,
                pipeline.chemistry.flare,
                pipeline.chemistry.localContrast,
            ]);
            floatVector(176, [
                pipeline.optics.halation,
                pipeline.optics.halationRadius,
                pipeline.optics.halationThreshold,
                0,
            ]);
            floatVector(192, [...pipeline.output.tint, pipeline.output.scanContrast]);
            floatVector(208, [
                pipeline.grain.meanRadius,
                pipeline.grain.radiusVariance,
                pipeline.grain.shadowBias,
                pipeline.grain.chroma,
            ]);
            return buffer;
        }

        async process(imageData, settings, seed, showOriginal = false, cacheSource = true) {
            if (!await this.initialize()) return null;
            const byteLength = imageData.data.byteLength;
            let source;
            if (cacheSource) {
                if (this.sourceCache?.imageData !== imageData) {
                    this.sourceCache?.buffer.destroy();
                    const buffer = this.device.createBuffer({
                        label: "grainlab-source",
                        size: byteLength,
                        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                    });
                    this.device.queue.writeBuffer(buffer, 0, imageData.data);
                    this.sourceCache = { imageData, buffer };
                }
                source = this.sourceCache.buffer;
            } else {
                source = this.device.createBuffer({
                    label: "grainlab-source",
                    size: byteLength,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                });
                this.device.queue.writeBuffer(source, 0, imageData.data);
            }
            const output = this.device.createBuffer({
                label: "grainlab-output",
                size: byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            });
            const readback = this.device.createBuffer({
                label: "grainlab-readback",
                size: byteLength,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            const params = this.device.createBuffer({
                label: "grainlab-params",
                size: PARAMETER_BYTES,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(params, 0, this.createParams(imageData, settings, seed, showOriginal));

            const bindGroup = this.device.createBindGroup({
                layout: this.pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: source } },
                    { binding: 1, resource: { buffer: output } },
                    { binding: 2, resource: { buffer: params } },
                ],
            });
            const commands = this.device.createCommandEncoder({ label: "grainlab-photo-commands" });
            const pass = commands.beginComputePass({ label: "grainlab-photo-pass" });
            pass.setPipeline(this.pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(imageData.width / 16), Math.ceil(imageData.height / 16));
            pass.end();
            commands.copyBufferToBuffer(output, 0, readback, 0, byteLength);
            this.device.queue.submit([commands.finish()]);

            await readback.mapAsync(GPUMapMode.READ);
            const pixels = new Uint8ClampedArray(readback.getMappedRange()).slice();
            readback.unmap();
            if (!cacheSource) source.destroy();
            output.destroy();
            readback.destroy();
            params.destroy();
            return new ImageData(pixels, imageData.width, imageData.height);
        }
    }

    root.GrainlabGPU = Object.freeze({
        createProcessor: () => new WgslPhotoProcessor(),
    });
})(typeof window === "undefined" ? globalThis : window);
