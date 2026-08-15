//! Tiny command-line interface for piping data in and out of ClipVault from a
//! terminal, e.g. `cat log.txt | clipvault add` or `clipvault get`. Runs against the
//! same on-disk (encrypted) database as the GUI, then exits — it never starts the
//! Tauri app, so the single-instance GUI isn't disturbed.

use std::io::Read;
use std::path::PathBuf;

use crate::classifier::classify_text;
use crate::hashing::sha256_hex;
use crate::storage::{NewItem, Storage};

/// Verbs handled by the CLI. `main` checks this before launching the GUI.
pub fn is_cli_verb(arg: &str) -> bool {
    matches!(arg, "add" | "get" | "list" | "help" | "--help" | "-h")
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// The ClipVault data directory (mirrors the GUI's `~/.local/share/clipvault`,
/// honoring `XDG_DATA_HOME`).
fn data_dir() -> PathBuf {
    if let Ok(x) = std::env::var("XDG_DATA_HOME") {
        if !x.is_empty() {
            return PathBuf::from(x).join("clipvault");
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".local/share/clipvault")
}

fn open_storage() -> Result<Storage, String> {
    Storage::open(&data_dir().join("clipvault.db")).map_err(|e| format!("cannot open database: {e}"))
}

const USAGE: &str = "\
ClipVault CLI

USAGE:
  clipvault add [text...]     Add text to the history (reads stdin if no text given)
  clipvault get               Print the most recent text entry
  clipvault list [N]          Print the N most recent text entries (default 10)
  clipvault help              Show this help

Examples:
  cat notes.txt | clipvault add
  clipvault add \"a quick note\"
  clipvault get | pbcopy
";

/// Run the CLI with the argument slice *including* the verb (argv[1..]). Returns a
/// process exit code.
pub fn run(args: &[String]) -> i32 {
    let verb = args.first().map(|s| s.as_str()).unwrap_or("help");
    match verb {
        "add" => cmd_add(&args[1..]),
        "get" => cmd_list(1),
        "list" => {
            let n = args.get(1).and_then(|s| s.parse::<i64>().ok()).unwrap_or(10);
            cmd_list(n.max(1))
        }
        _ => {
            print!("{USAGE}");
            0
        }
    }
}

fn cmd_add(rest: &[String]) -> i32 {
    let text = if rest.is_empty() {
        let mut s = String::new();
        if std::io::stdin().read_to_string(&mut s).is_err() {
            eprintln!("clipvault: failed to read stdin");
            return 1;
        }
        s.trim_end_matches(['\n', '\r']).to_string()
    } else {
        rest.join(" ")
    };
    if text.is_empty() {
        eprintln!("clipvault: nothing to add (empty input)");
        return 1;
    }
    let storage = match open_storage() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("clipvault: {e}");
            return 1;
        }
    };
    let item = NewItem {
        item_type: classify_text(&text),
        content: Some(text.clone()),
        file_path: None,
        preview_path: None,
        content_hash: sha256_hex(text.as_bytes()),
        source_app: None,
        html: None,
    };
    match storage.insert_or_bump(item, now_ms()) {
        Ok(_) => {
            eprintln!("clipvault: added {} chars", text.chars().count());
            0
        }
        Err(e) => {
            eprintln!("clipvault: add failed: {e}");
            1
        }
    }
}

fn cmd_list(n: i64) -> i32 {
    let storage = match open_storage() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("clipvault: {e}");
            return 1;
        }
    };
    match storage.list_items(n, None, None) {
        Ok(items) => {
            if items.is_empty() {
                eprintln!("clipvault: history is empty");
                return 0;
            }
            for it in items {
                match it.content {
                    Some(c) => println!("{c}"),
                    None => println!("[{}]", it.item_type),
                }
            }
            0
        }
        Err(e) => {
            eprintln!("clipvault: read failed: {e}");
            1
        }
    }
}
