fn main() {
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    println!("cargo:rustc-check-cfg=cfg(time_tracker_local_build)");
    if std::env::var("TAURI_CONFIG")
        .map(|config| {
            config.contains("com.timetracker.local") || config.contains("Time Tracker Local")
        })
        .unwrap_or(false)
    {
        println!("cargo:rustc-cfg=time_tracker_local_build");
    }

    tauri_build::build()
}
