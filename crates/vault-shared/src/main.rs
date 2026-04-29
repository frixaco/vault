use std::{env, ffi::OsString, path::PathBuf};

use vault_shared_ffi::files::markdown_file_paths;

fn main() {
    let mut args = env::args_os().skip(1);
    let first = args.next().unwrap_or_else(|| {
        print_usage_and_exit();
    });

    let root = match first.to_string_lossy().as_ref() {
        "files" => args.next().unwrap_or_else(|| {
            print_usage_and_exit();
        }),
        "--help" | "-h" | "help" => {
            print_usage_and_exit();
        }
        _ => first,
    };

    if let Err(error) = list_files(PathBuf::from(root)) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn list_files(root: PathBuf) -> Result<(), jwalk::Error> {
    for path in markdown_file_paths(root)? {
        println!("{}", path.display());
    }

    Ok(())
}

fn print_usage_and_exit() -> ! {
    let binary = env::args_os()
        .next()
        .unwrap_or_else(|| OsString::from("vault-shared"));
    eprintln!(
        "usage: {} files <notes-dir>",
        PathBuf::from(binary).display()
    );
    std::process::exit(2);
}
