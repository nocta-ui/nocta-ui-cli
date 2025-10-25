use std::env;
use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};

use crate::constants::registry::CSS_BUNDLE_PATH;
use crate::fs as project_fs;
use crate::registry::RegistryClient;

const TOKENS_MARKER: &str = "NOCTA CSS THEME VARIABLES";

#[derive(Debug, Clone, Default)]
pub struct TailwindCheck {
    pub installed: bool,
    pub version: Option<String>,
}

fn current_dir() -> PathBuf {
    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn css_full_path(css_path: &str) -> PathBuf {
    current_dir().join(css_path)
}

fn strip_tailwind_import(snippet: &str) -> String {
    snippet
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !(trimmed.starts_with("@import") && trimmed.contains("tailwindcss"))
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim_start_matches('\n')
        .to_string()
}

fn insert_snippet(existing: &str, snippet: &str) -> String {
    let snippet = snippet.trim_matches('\n');
    if snippet.is_empty() {
        return existing.to_string();
    }

    if existing.is_empty() {
        return format!("{}\n", snippet);
    }

    let lines: Vec<&str> = existing.lines().collect();
    let mut insert_index: Option<usize> = None;

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with("@import") {
            insert_index = Some(idx + 1);
        } else if !trimmed.is_empty()
            && !trimmed.starts_with('@')
            && !trimmed.starts_with("/*")
            && !trimmed.starts_with("//")
        {
            break;
        }
    }

    let mut result_lines: Vec<String> = Vec::new();

    match insert_index {
        Some(index) => {
            for line in &lines[..index] {
                result_lines.push((*line).to_string());
            }
            if !result_lines.last().map(|l| l.is_empty()).unwrap_or(false) {
                result_lines.push(String::new());
            }
            result_lines.extend(snippet.lines().map(|line| line.to_string()));
            result_lines.push(String::new());
            for line in &lines[index..] {
                result_lines.push((*line).to_string());
            }
        }
        None => {
            result_lines.extend(snippet.lines().map(|line| line.to_string()));
            result_lines.push(String::new());
            for line in &lines {
                result_lines.push((*line).to_string());
            }
        }
    }

    let mut result = result_lines.join("\n");
    if existing.ends_with('\n') {
        result.push('\n');
    }
    result
}

pub fn add_design_tokens_to_css(registry: &RegistryClient, css_path: &str) -> Result<bool> {
    let full_path = css_full_path(css_path);
    let registry_css = registry
        .fetch_registry_asset(CSS_BUNDLE_PATH)
        .with_context(|| format!("failed to fetch registry CSS asset '{}'", CSS_BUNDLE_PATH))?;
    let trimmed_registry_css = registry_css.trim_start();

    let css_content = if full_path.exists() {
        fs::read_to_string(&full_path)
            .with_context(|| format!("failed to read CSS file '{}'", full_path.display()))?
    } else {
        String::new()
    };

    if css_content.contains(TOKENS_MARKER) {
        return Ok(false);
    }

    let has_tailwind_import = css_content.contains("@import \"tailwindcss\"")
        || css_content.contains("@import 'tailwindcss'");

    let normalized_snippet = if has_tailwind_import {
        strip_tailwind_import(trimmed_registry_css)
    } else {
        trimmed_registry_css.to_string()
    };

    let new_content = insert_snippet(&css_content, &normalized_snippet);

    project_fs::ensure_parent_dir(&full_path)?;
    fs::write(&full_path, new_content)
        .with_context(|| format!("failed to write CSS file '{}'", full_path.display()))?;

    Ok(true)
}

pub fn check_tailwind_installation() -> TailwindCheck {
    let declared_version = read_declared_tailwind_version();

    match declared_version {
        None => TailwindCheck {
            installed: false,
            version: None,
        },
        Some(declared) => {
            let installed_version = read_installed_tailwind_version();
            if let Some(actual) = installed_version {
                TailwindCheck {
                    installed: true,
                    version: Some(actual),
                }
            } else {
                TailwindCheck {
                    installed: false,
                    version: Some(declared),
                }
            }
        }
    }
}

fn read_declared_tailwind_version() -> Option<String> {
    let data = fs::read_to_string("package.json").ok()?;
    let json: serde_json::Value = serde_json::from_str(&data).ok()?;

    json.get("dependencies")
        .and_then(|deps| deps.get("tailwindcss"))
        .and_then(|value| value.as_str().map(|s| s.to_string()))
        .or_else(|| {
            json.get("devDependencies")
                .and_then(|deps| deps.get("tailwindcss"))
                .and_then(|value| value.as_str().map(|s| s.to_string()))
        })
}

fn read_installed_tailwind_version() -> Option<String> {
    let mut dir = current_dir();

    loop {
        let path = dir.join("node_modules/tailwindcss/package.json");
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(version) = json
                    .get("version")
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string())
                {
                    return Some(version);
                }
            }
        }

        if !dir.pop() {
            break;
        }
    }

    None
}
