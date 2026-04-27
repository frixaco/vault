use std::{env, path::PathBuf};

use jwalk::{Error, WalkDir};

fn list_files(root: PathBuf) -> Result<(), Error> {
    let walk_dir = WalkDir::new(root).process_read_dir(|_, _, _, children| {
        children.retain(|dir_entry_result| {
            dir_entry_result
                .as_ref()
                .map(|dir_entry| {
                    let path = dir_entry.path();
                    path.is_dir()
                        || path
                            .extension()
                            .and_then(|extension| extension.to_str())
                            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
                })
                .unwrap_or(false)
        });
    });

    for entry in walk_dir {
        let entry = entry?;
        if entry.file_type().is_file() {
            println!("{}", entry.path().display());
        }
    }

    Ok(())
}

fn main() {
    let root = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .expect("usage: files <notes-dir>");

    if let Err(error) = list_files(root) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
