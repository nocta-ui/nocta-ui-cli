use std::path::{Path, PathBuf};

use crate::types::Config;

pub fn resolve_component_path(component_file_path: &str, config: &Config) -> PathBuf {
    let mut relative = component_file_path.trim_start_matches("./");
    relative = relative.trim_start_matches('/');
    relative = strip_known_prefixes(relative);

    let base_path = config.aliases.components.filesystem_path();
    let base = Path::new(base_path);
    let alias_suffix = extract_alias_suffix(base_path);

    let mut effective_relative = if let Some(stripped) = relative.strip_prefix("components/") {
        stripped
    } else if relative == "components" {
        ""
    } else {
        relative
    };

    effective_relative = trim_alias_suffix(effective_relative, &alias_suffix);

    if effective_relative.is_empty() {
        if let Some(file_name) = Path::new(component_file_path).file_name() {
            base.join(file_name)
        } else {
            base.join(component_file_path)
        }
    } else {
        base.join(effective_relative)
    }
}

fn strip_known_prefixes(path: &str) -> &str {
    let mut current = path;
    for prefix in ["app/", "src/"] {
        if let Some(stripped) = current.strip_prefix(prefix) {
            current = stripped;
        }
    }
    current
}

fn extract_alias_suffix(path: &str) -> String {
    let mut normalized = path.trim_start_matches("./").trim_start_matches('/');
    normalized = strip_known_prefixes(normalized);
    normalized = normalized.trim_start_matches("components/");
    normalized.trim_start_matches('/').to_string()
}

fn trim_alias_suffix<'a>(relative: &'a str, alias_suffix: &str) -> &'a str {
    if alias_suffix.is_empty() || relative.is_empty() {
        return relative;
    }

    if relative == alias_suffix {
        ""
    } else if relative.starts_with(alias_suffix) {
        let remainder = &relative[alias_suffix.len()..];
        if remainder.starts_with('/') {
            remainder.trim_start_matches('/')
        } else {
            relative
        }
    } else {
        relative
    }
}
