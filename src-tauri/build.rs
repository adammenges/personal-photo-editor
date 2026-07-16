use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use serde_json::Value;

fn collect_definitions(directory: &Path, definitions: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory).expect("film stock directory must be readable") {
        let path = entry.expect("film stock entry must be readable").path();
        if path.is_dir() {
            collect_definitions(&path, definitions);
        } else if path
            .extension()
            .is_some_and(|extension| extension == "json")
            && path.file_name().is_some_and(|name| name != "index.json")
        {
            definitions.push(path);
        }
    }
}

fn required_string<'a>(stock: &'a Value, key: &str, source: &Path) -> &'a str {
    stock[key]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| panic!("{} must define a non-empty {key}", source.display()))
}

fn validate_number(section: &Value, key: &str, minimum: f64, maximum: f64, source: &Path) {
    let value = section[key]
        .as_f64()
        .unwrap_or_else(|| panic!("{} must define numeric pipeline.{key}", source.display()));
    assert!(
        (minimum..=maximum).contains(&value),
        "{} pipeline.{key} must be between {minimum} and {maximum}",
        source.display()
    );
}

fn validate_vector(value: &Value, label: &str, minimum: f64, maximum: f64, source: &Path) {
    let components = value
        .as_array()
        .filter(|components| components.len() == 3)
        .unwrap_or_else(|| panic!("{} pipeline.{label} must be a 3-vector", source.display()));
    for component in components {
        let number = component.as_f64().unwrap_or_else(|| {
            panic!(
                "{} pipeline.{label} components must be numeric",
                source.display()
            )
        });
        assert!(
            (minimum..=maximum).contains(&number),
            "{} pipeline.{label} components must be between {minimum} and {maximum}",
            source.display()
        );
    }
}

fn validate_pipeline(pipeline: &Value, source: &Path) {
    assert_eq!(
        pipeline["version"].as_u64(),
        Some(1),
        "{} must define pipeline schema version 1",
        source.display()
    );
    let family = required_string(pipeline, "family", source);
    assert!(
        matches!(family, "utility" | "bw" | "c41" | "e6" | "ecn2" | "print"),
        "{} has unsupported pipeline family {family}",
        source.display()
    );
    assert!(
        pipeline["monochrome"].is_boolean(),
        "{} pipeline.monochrome must be Boolean",
        source.display()
    );

    let scene = &pipeline["scene"];
    validate_vector(&scene["sensitivity"], "scene.sensitivity", 0.0, 2.0, source);
    validate_number(scene, "flash", 0.0, 0.2, source);
    let curve = &pipeline["curve"];
    for key in ["toe", "shoulder", "saturationCompression"] {
        validate_number(curve, key, 0.0, 1.0, source);
    }
    validate_number(curve, "gamma", 0.45, 1.8, source);

    let crossover = &pipeline["crossover"];
    validate_vector(
        &crossover["shadows"],
        "crossover.shadows",
        -0.2,
        0.2,
        source,
    );
    validate_vector(
        &crossover["highlights"],
        "crossover.highlights",
        -0.2,
        0.2,
        source,
    );
    let chemistry = &pipeline["chemistry"];
    validate_number(chemistry, "silverRetention", 0.0, 1.0, source);
    validate_number(chemistry, "fog", 0.0, 0.2, source);
    validate_number(chemistry, "flare", 0.0, 0.15, source);
    validate_number(chemistry, "localContrast", 0.0, 0.4, source);

    let optics = &pipeline["optics"];
    validate_number(optics, "halation", 0.0, 0.7, source);
    validate_number(optics, "halationRadius", 0.0, 64.0, source);
    validate_number(optics, "halationThreshold", 0.0, 1.0, source);
    let output = &pipeline["output"];
    validate_vector(&output["tint"], "output.tint", 0.5, 1.5, source);
    validate_number(output, "scanContrast", 0.5, 1.5, source);

    let grain = &pipeline["grain"];
    validate_number(grain, "meanRadius", 0.2, 2.5, source);
    validate_number(grain, "radiusVariance", 0.0, 1.5, source);
    validate_number(grain, "shadowBias", 0.0, 1.5, source);
    validate_number(grain, "chroma", 0.0, 0.15, source);
}

fn validate_palette(dossier: &Value, source: &Path) {
    for swatch in dossier["palette"]
        .as_array()
        .expect("palette validated above")
    {
        required_string(swatch, "name", source);
        let color = required_string(swatch, "hex", source);
        assert!(
            color.len() == 7
                && color.starts_with('#')
                && color[1..]
                    .chars()
                    .all(|character| character.is_ascii_hexdigit()),
            "{} contains invalid dossier palette color {color}",
            source.display()
        );
    }
}

fn validate_chapters(dossier: &Value, source: &Path) {
    for chapter in dossier["chapters"]
        .as_array()
        .expect("chapters validated above")
    {
        for key in ["eyebrow", "title", "lede"] {
            required_string(chapter, key, source);
        }
        let details = chapter["details"].as_array().unwrap_or_else(|| {
            panic!(
                "{} dossier chapters must define a details array",
                source.display()
            )
        });
        assert!(
            !details.is_empty(),
            "{} dossier chapter details cannot be empty",
            source.display()
        );
        for detail in details {
            required_string(detail, "label", source);
            required_string(detail, "value", source);
        }
    }
}

fn validate_dossier(dossier: &Value, source: &Path) {
    assert_eq!(
        dossier["version"].as_u64(),
        Some(1),
        "{} must define dossier schema version 1",
        source.display()
    );
    for key in ["tagline", "portrait", "verified", "disclaimer"] {
        required_string(dossier, key, source);
    }
    let reference = &dossier["reference"];
    for key in ["stock", "manufacturer", "relationship", "status"] {
        required_string(reference, key, source);
    }
    for key in [
        "facts",
        "palette",
        "chapters",
        "bestFor",
        "watchFor",
        "fieldNotes",
        "sources",
    ] {
        assert!(
            dossier[key]
                .as_array()
                .is_some_and(|values| !values.is_empty()),
            "{} must define a non-empty dossier.{key} array",
            source.display()
        );
    }
    for fact in dossier["facts"].as_array().expect("facts validated above") {
        required_string(fact, "label", source);
        required_string(fact, "value", source);
    }
    validate_palette(dossier, source);
    validate_chapters(dossier, source);
    for key in ["bestFor", "watchFor", "fieldNotes"] {
        for value in dossier[key].as_array().expect("text array validated above") {
            assert!(
                value.as_str().is_some_and(|text| !text.trim().is_empty()),
                "{} dossier.{key} must contain non-empty strings",
                source.display()
            );
        }
    }
    for reference_source in dossier["sources"]
        .as_array()
        .expect("sources validated above")
    {
        required_string(reference_source, "title", source);
        required_string(reference_source, "publisher", source);
        let url = required_string(reference_source, "url", source);
        assert!(
            url.starts_with("https://"),
            "{} dossier source URLs must use HTTPS",
            source.display()
        );
    }
}

fn validate_stock(stock: &Value, source: &Path, identifiers: &mut HashSet<String>) {
    let identifier = required_string(stock, "id", source);
    assert!(
        identifiers.insert(identifier.to_owned()),
        "duplicate film stock id: {identifier}"
    );
    required_string(stock, "name", source);
    required_string(stock, "maker", source);
    required_string(stock, "group", source);
    let stock_type = required_string(stock, "type", source);
    assert!(
        matches!(stock_type, "color" | "mono" | "utility"),
        "{} has unsupported film stock type {stock_type}",
        source.display()
    );
    assert!(
        stock["settings"].is_object(),
        "{} must define settings",
        source.display()
    );
    let grain = &stock["grainProfile"];
    for key in ["medium", "crystal", "emulsion", "scale", "process"] {
        required_string(grain, key, source);
    }
    validate_pipeline(&stock["pipeline"], source);
    validate_dossier(&stock["dossier"], source);
}

fn main() {
    let stock_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../ui/film-stocks");
    println!("cargo:rerun-if-changed={}", stock_directory.display());

    let mut definitions = Vec::new();
    collect_definitions(&stock_directory, &mut definitions);
    definitions.sort();

    let mut identifiers = HashSet::new();
    let mut stocks: Vec<Value> = definitions
        .iter()
        .map(|source| {
            let contents = fs::read_to_string(source)
                .unwrap_or_else(|error| panic!("could not read {}: {error}", source.display()));
            let stock: Value = serde_json::from_str(&contents)
                .unwrap_or_else(|error| panic!("invalid JSON in {}: {error}", source.display()));
            validate_stock(&stock, source, &mut identifiers);
            stock
        })
        .collect();
    stocks.sort_by_key(|stock| stock["sort"].as_i64().unwrap_or(i64::MAX));

    let manifest_path = stock_directory.join("index.json");
    let manifest = format!(
        "{}\n",
        serde_json::to_string_pretty(&stocks).expect("film stock manifest must serialize")
    );
    if fs::read_to_string(&manifest_path).ok().as_deref() != Some(&manifest) {
        fs::write(&manifest_path, manifest).expect("film stock manifest must be writable");
    }

    tauri_build::build();
}
