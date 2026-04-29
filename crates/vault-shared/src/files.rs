use std::path::{Path, PathBuf};

use jwalk::{Error, WalkDir};

pub fn markdown_file_paths(root: impl AsRef<Path>) -> Result<Vec<PathBuf>, Error> {
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

    let mut files = Vec::new();
    for entry in walk_dir {
        let entry = entry?;
        if entry.file_type().is_file() {
            files.push(entry.path());
        }
    }

    Ok(files)
}
