// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // CLI mode: when invoked with a known verb (e.g. `clipvault add`, `clipvault get`)
    // run the terminal command against the DB and exit, without starting the GUI (so
    // the single-instance app isn't disturbed).
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && clipvault_lib::cli::is_cli_verb(&args[1]) {
        std::process::exit(clipvault_lib::cli::run(&args[1..]));
    }
    clipvault_lib::run()
}
