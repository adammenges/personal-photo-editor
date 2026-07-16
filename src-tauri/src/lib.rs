#[tauri::command]
fn get_build_command(app_name: String, bundle_id: String) -> String {
    format!(
        "$ APP_NAME=\"{}\" APP_BUNDLE_ID=\"{}\" ./scripts/build_macos_app.sh",
        app_name.trim(),
        bundle_id.trim()
    )
}

#[tauri::command]
fn get_check_command() -> String {
    String::from("$ ./scripts/check.sh")
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_build_command, get_check_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
