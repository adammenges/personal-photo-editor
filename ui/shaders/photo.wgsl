struct Params {
    size: vec2<u32>,
    seed: u32,
    flags: u32,
    tone: vec4<f32>,
    color: vec4<f32>,
    texture: vec4<f32>,
    grain_model: vec4<u32>,
    process_model: vec4<u32>,
    scene: vec4<f32>,
    curve: vec4<f32>,
    crossover_shadow: vec4<f32>,
    crossover_highlight: vec4<f32>,
    chemistry: vec4<f32>,
    optics: vec4<f32>,
    output_transform: vec4<f32>,
    grain_detail: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> source_pixels: array<u32>;
@group(0) @binding(1) var<storage, read_write> output_pixels: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

fn unpack_rgba(pixel: u32) -> vec4<f32> {
    return vec4<f32>(
        f32(pixel & 255u),
        f32((pixel >> 8u) & 255u),
        f32((pixel >> 16u) & 255u),
        f32((pixel >> 24u) & 255u),
    );
}

fn pack_rgba(color: vec4<f32>) -> u32 {
    let value = vec4<u32>(clamp(color, vec4<f32>(0.0), vec4<f32>(255.0)) + vec4<f32>(0.5));
    return value.r | (value.g << 8u) | (value.b << 16u) | (value.a << 24u);
}

fn srgb_channel_to_linear(value: f32) -> f32 {
    if value <= 0.04045 {
        return value / 12.92;
    }
    return pow((value + 0.055) / 1.055, 2.4);
}

fn srgb_to_linear(color: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        srgb_channel_to_linear(color.r),
        srgb_channel_to_linear(color.g),
        srgb_channel_to_linear(color.b),
    );
}

fn linear_channel_to_srgb(value: f32) -> f32 {
    let bounded = clamp(value, 0.0, 1.0);
    if bounded <= 0.0031308 {
        return bounded * 12.92;
    }
    return 1.055 * pow(bounded, 1.0 / 2.4) - 0.055;
}

fn linear_to_srgb(color: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        linear_channel_to_srgb(color.r),
        linear_channel_to_srgb(color.g),
        linear_channel_to_srgb(color.b),
    );
}

fn luminance(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn bounded_coordinate(coordinate: vec2<i32>) -> vec2<i32> {
    let maximum = vec2<i32>(i32(params.size.x) - 1, i32(params.size.y) - 1);
    return clamp(coordinate, vec2<i32>(0), maximum);
}

fn source_rgba(coordinate: vec2<i32>) -> vec4<f32> {
    let bounded = bounded_coordinate(coordinate);
    let index = u32(bounded.y) * params.size.x + u32(bounded.x);
    return unpack_rgba(source_pixels[index]);
}

// Scene stage: decode display RGB to scene-linear light, then apply exposure,
// white balance, and the emulsion's channel sensitivity before any film curve.
fn scene_sample(coordinate: vec2<i32>) -> vec3<f32> {
    let encoded = source_rgba(coordinate).rgb / 255.0;
    let exposed = srgb_to_linear(encoded) * params.tone.x * params.color.rgb;
    if params.process_model.z == 1u {
        let neutral = dot(exposed, params.scene.rgb) + params.scene.w;
        return vec3<f32>(neutral);
    }
    return exposed * params.scene.rgb + vec3<f32>(params.scene.w);
}

fn toe_function(value: f32) -> f32 {
    let bounded = clamp(value, 0.0, 1.0);
    return bounded * bounded * 1.18 / (bounded + 0.18);
}

// A normalized H-D approximation with independently controllable toe,
// shoulder, and development gamma. Zero toe/shoulder and gamma 1 is identity.
fn emulsion_curve_channel(input: f32) -> f32 {
    var value = max(0.0, input);
    value /= 1.0 + params.curve.y * max(0.0, value - 1.0) * 2.0;
    value = clamp(value, 0.0, 1.0);
    value = mix(value, toe_function(value), params.curve.x);
    value = mix(value, 1.0 - toe_function(1.0 - value), params.curve.y);
    return pow(clamp(value, 0.0, 1.0), max(0.05, params.curve.z));
}

fn emulsion_curve(color: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        emulsion_curve_channel(color.r),
        emulsion_curve_channel(color.g),
        emulsion_curve_channel(color.b),
    );
}

fn halation_signal(coordinate: vec2<i32>) -> f32 {
    let color = scene_sample(coordinate);
    let mask = clamp(
        (luminance(color) - params.optics.z) / max(0.001, 1.0 - params.optics.z),
        0.0,
        1.0,
    );
    return max(max(color.r, color.g), color.b) * mask;
}

// Halation is exposure spilled back into the emulsion from bright scene light.
// It is deliberately evaluated before the emulsion curve and output transform.
fn halation_from_scene(coordinate: vec2<i32>) -> f32 {
    if params.optics.x <= 0.0 || params.optics.y <= 0.0 {
        return 0.0;
    }
    let long_edge = f32(max(params.size.x, params.size.y));
    let radius = max(1, i32(round(params.optics.y * long_edge / 2048.0)));
    let half_radius = max(1, radius / 2);
    var signal = 0.0;
    signal += halation_signal(coordinate + vec2<i32>(radius, 0));
    signal += halation_signal(coordinate + vec2<i32>(-radius, 0));
    signal += halation_signal(coordinate + vec2<i32>(0, radius));
    signal += halation_signal(coordinate + vec2<i32>(0, -radius));
    signal += halation_signal(coordinate + vec2<i32>(half_radius, half_radius));
    signal += halation_signal(coordinate + vec2<i32>(-half_radius, half_radius));
    signal += halation_signal(coordinate + vec2<i32>(half_radius, -half_radius));
    signal += halation_signal(coordinate + vec2<i32>(-half_radius, -half_radius));
    return signal * 0.125 * params.optics.x * 0.28;
}

fn local_density_detail(coordinate: vec2<i32>, center: vec3<f32>) -> f32 {
    if params.chemistry.w <= 0.0 {
        return 0.0;
    }
    var neighborhood = 0.0;
    neighborhood += luminance(scene_sample(coordinate + vec2<i32>(2, 0)));
    neighborhood += luminance(scene_sample(coordinate + vec2<i32>(-2, 0)));
    neighborhood += luminance(scene_sample(coordinate + vec2<i32>(0, 2)));
    neighborhood += luminance(scene_sample(coordinate + vec2<i32>(0, -2)));
    return (luminance(center) - neighborhood * 0.25) * params.chemistry.w;
}

fn hash_unit(x: u32, y: u32, seed: u32, lane: u32) -> f32 {
    var value = (x * 0x1f123bb5u)
        ^ (y * 0x5f356495u)
        ^ (seed * 0x6c8e9cf5u)
        ^ (lane * 0x27d4eb2du);
    value = value ^ (value >> 16u);
    value = value * 0x7feb352du;
    value = value ^ (value >> 15u);
    value = value * 0x846ca68bu;
    value = value ^ (value >> 16u);
    return f32(value) / 4294967296.0;
}

fn gaussian_at(coordinate: vec2<i32>, seed: u32) -> f32 {
    let bounded = max(coordinate, vec2<i32>(0));
    let x = u32(bounded.x);
    let y = u32(bounded.y);
    let sum = hash_unit(x, y, seed, 0u)
        + hash_unit(x, y, seed, 1u)
        + hash_unit(x, y, seed, 2u)
        + hash_unit(x, y, seed, 3u);
    return (sum - 2.0) * 1.7320508;
}

fn smooth_curve(value: vec2<f32>) -> vec2<f32> {
    return value * value * (vec2<f32>(3.0) - 2.0 * value);
}

// Continuous value noise avoids the repeated rosette artifact of tiled grain.
fn value_noise(coordinate: vec2<f32>, radius: f32, seed: u32) -> f32 {
    let position = coordinate / radius;
    let base = vec2<i32>(floor(position));
    let blend = smooth_curve(fract(position));
    let top = mix(
        gaussian_at(base, seed),
        gaussian_at(base + vec2<i32>(1, 0), seed),
        blend.x,
    );
    let bottom = mix(
        gaussian_at(base + vec2<i32>(0, 1), seed),
        gaussian_at(base + vec2<i32>(1, 1), seed),
        blend.x,
    );
    return mix(top, bottom, blend.y);
}

fn film_grain(rgb: vec3<f32>, coordinate: vec2<f32>) -> vec3<f32> {
    let strength = clamp(params.texture.z, 0.0, 64.0);
    if strength <= 0.0 {
        return rgb;
    }

    var sharp_weight = 0.44;
    var fine_weight = 0.42;
    var soft_weight = 0.10;
    var coarse_weight = 0.04;
    var amplitude_model = 0.82;
    var tail = 1.0;

    if params.grain_model.y == 0u {
        sharp_weight = 0.32;
        fine_weight = 0.28;
        soft_weight = 0.12;
        coarse_weight = 0.28;
        amplitude_model = 1.14;
        tail = 1.12;
    } else if params.grain_model.y == 2u {
        sharp_weight = 0.16;
        fine_weight = 0.46;
        soft_weight = 0.32;
        coarse_weight = 0.06;
        amplitude_model = 0.78;
        tail = 0.96;
    }

    if params.grain_model.x == 1u {
        soft_weight *= 1.18;
        amplitude_model *= 0.92;
    } else {
        sharp_weight *= 1.12;
        amplitude_model *= 1.06;
    }
    if params.grain_model.z == 0u {
        coarse_weight *= 0.72;
        amplitude_model *= 0.92;
    } else if params.grain_model.z == 2u {
        coarse_weight *= 0.82;
        amplitude_model *= 0.78;
    }
    if params.grain_model.w == 0u {
        sharp_weight *= 1.18;
        fine_weight *= 1.18;
        coarse_weight *= 0.34;
        amplitude_model *= 0.70;
    } else if params.grain_model.w == 2u {
        sharp_weight *= 0.66;
        soft_weight *= 1.28;
        coarse_weight *= 1.72;
        amplitude_model *= 1.34;
    }

    let process = params.process_model.x;
    if process == 1u {
        coarse_weight *= 1.36;
        amplitude_model *= 1.32;
        tail = max(tail, 1.16);
    } else if process == 2u {
        fine_weight *= 1.14;
        soft_weight *= 1.22;
        coarse_weight *= 0.82;
        amplitude_model *= 0.84;
    } else if process == 3u {
        coarse_weight *= 0.72;
        amplitude_model *= 0.84;
    } else if process == 4u {
        sharp_weight *= 1.16;
        amplitude_model *= 1.18;
    } else if process == 5u {
        coarse_weight *= 1.10;
        amplitude_model *= 1.10;
    }

    coarse_weight *= 1.0 + params.grain_detail.y * 0.65;
    let radius_scale = clamp(params.grain_detail.x / 0.8, 0.45, 2.4);
    let sharp = gaussian_at(vec2<i32>(coordinate), params.seed ^ 0x243f6a88u);
    let fine = value_noise(coordinate, 1.55 * radius_scale, params.seed ^ 0x243f6a88u);
    let soft = value_noise(coordinate, 2.65 * radius_scale, params.seed ^ 0x243f6a88u);
    let coarse = value_noise(coordinate, 5.2 * radius_scale, params.seed ^ 0x243f6a88u);
    let display_luminance = clamp(dot(rgb, vec3<f32>(0.299, 0.587, 0.114)) / 255.0, 0.0, 1.0);

    if params.grain_model.z == 1u {
        coarse_weight *= 1.0 + (1.0 - display_luminance) * 0.62;
    }
    let energy = inverseSqrt(
        sharp_weight * sharp_weight
        + fine_weight * fine_weight
        + soft_weight * soft_weight
        + coarse_weight * coarse_weight
    );
    var base_noise = (
        sharp * sharp_weight
        + fine * fine_weight
        + soft * soft_weight
        + coarse * coarse_weight
    ) * energy;
    if tail != 1.0 {
        base_noise = sign(base_noise) * pow(abs(base_noise), tail);
    }

    let density_variance = pow(max(0.0, 4.0 * display_luminance * (1.0 - display_luminance)), 0.65);
    var density_scale = (0.30 + density_variance * 0.70)
        * (1.0 + (1.0 - display_luminance) * params.grain_detail.z);
    if params.grain_model.z == 2u {
        density_scale *= 0.68 + display_luminance * 0.32;
    }
    if process == 1u {
        density_scale *= 1.0 + (1.0 - display_luminance) * 0.30;
    }
    let grain_amplitude = strength * 0.18 * amplitude_model * density_scale;

    if params.grain_model.x == 0u {
        return rgb + vec3<f32>(base_noise * grain_amplitude);
    }

    var chroma_weight = clamp(params.grain_detail.w + (strength / 64.0) * 0.02, 0.0, 0.16);
    if process == 2u {
        chroma_weight *= 0.70;
    } else if process == 5u {
        chroma_weight *= 1.35;
    }
    let red_layer = value_noise(coordinate, 2.1 * radius_scale, params.seed ^ 0x85a308d3u);
    let blue_layer = value_noise(coordinate, 2.3 * radius_scale, params.seed ^ 0x13198a2eu);
    let shared_weight = 1.0 - chroma_weight;
    let layer_noise = vec3<f32>(
        base_noise * shared_weight + red_layer * chroma_weight,
        base_noise * (1.0 - chroma_weight * 0.55) - (red_layer + blue_layer) * chroma_weight * 0.225,
        base_noise * shared_weight + blue_layer * chroma_weight,
    );
    return rgb + layer_noise * grain_amplitude;
}

@compute @workgroup_size(16, 16)
fn process_photo(@builtin(global_invocation_id) invocation: vec3<u32>) {
    if invocation.x >= params.size.x || invocation.y >= params.size.y {
        return;
    }
    let index = invocation.y * params.size.x + invocation.x;
    if (params.flags & 1u) != 0u {
        output_pixels[index] = source_pixels[index];
        return;
    }

    let coordinate = vec2<i32>(i32(invocation.x), i32(invocation.y));
    let original = unpack_rgba(source_pixels[index]);
    var scene_color = scene_sample(coordinate);
    let halo = halation_from_scene(coordinate);
    if params.process_model.z == 1u {
        scene_color += vec3<f32>(halo);
    } else {
        scene_color += vec3<f32>(halo, halo * 0.30, halo * 0.08);
    }

    var color = emulsion_curve(scene_color);
    var neutral = luminance(color);
    let shadow_mask = pow(1.0 - clamp(neutral, 0.0, 1.0), 2.0);
    let highlight_mask = pow(clamp(neutral, 0.0, 1.0), 2.0);
    color += params.crossover_shadow.rgb * shadow_mask + params.crossover_highlight.rgb * highlight_mask;

    neutral = luminance(color);
    let chroma = max(max(color.r, color.g), color.b) - min(min(color.r, color.g), color.b);
    let emulsion_saturation = 1.0 / (1.0 + params.curve.w * chroma * 2.0);
    color = vec3<f32>(neutral) + (color - vec3<f32>(neutral)) * emulsion_saturation;

    neutral = luminance(color);
    let silver_retention = params.chemistry.x;
    color = vec3<f32>(neutral) + (color - vec3<f32>(neutral)) * (1.0 - silver_retention * 0.78);
    let chemical_base = params.chemistry.y + params.chemistry.z
        + local_density_detail(coordinate, scene_color);
    color = (color - vec3<f32>(0.18)) * (1.0 + silver_retention * 0.46)
        + vec3<f32>(0.18 + chemical_base);

    neutral = luminance(color);
    let bounded_luminance = clamp(neutral, 0.0, 1.0);
    let shadow_shift = params.tone.w * 0.12 * pow(1.0 - bounded_luminance, 2.0);
    let highlight_shift = params.tone.z * 0.12 * pow(bounded_luminance, 2.0);
    color += vec3<f32>(shadow_shift + highlight_shift);

    color = (color - vec3<f32>(0.18)) * params.output_transform.w + vec3<f32>(0.18);
    color = (color - vec3<f32>(0.18)) * params.tone.y + vec3<f32>(0.18);
    neutral = luminance(color);
    color = vec3<f32>(neutral) + (color - vec3<f32>(neutral)) * params.color.w;

    if params.texture.x > 0.0 {
        color = color * (1.0 - params.texture.x)
            + vec3<f32>(0.10, 0.104, 0.096) * params.texture.x;
    }
    if params.texture.y > 0.0 {
        let center = vec2<f32>(params.size) * 0.5;
        let maximum = length(center);
        let distance = length(vec2<f32>(invocation.xy) - center) / maximum;
        let edge = max(0.0, (distance - 0.25) / 0.75);
        color *= 1.0 - params.texture.y * edge * edge * 0.85;
    }

    color *= params.output_transform.rgb;
    var display = linear_to_srgb(color) * 255.0;
    display = film_grain(display, vec2<f32>(invocation.xy));
    output_pixels[index] = pack_rgba(vec4<f32>(display, original.a));
}
