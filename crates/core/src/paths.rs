use std::path::{Path, PathBuf};

use crate::types::Config;

pub fn resolve_component_path(component_file_path: &str, config: &Config) -> PathBuf {
    let file_name = Path::new(component_file_path)
        .file_name()
        .map(|name| name.to_owned())
        .unwrap_or_default();

    Path::new(&config.aliases.components)
        .join(file_name)
        .into()
}
