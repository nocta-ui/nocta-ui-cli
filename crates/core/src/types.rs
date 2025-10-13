use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentFile {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub file_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub name: String,
    pub description: String,
    pub category: String,
    pub files: Vec<ComponentFile>,
    #[serde(default)]
    pub dependencies: HashMap<String, String>,
    #[serde(default)]
    pub internal_dependencies: Vec<String>,
    #[serde(default)]
    pub exports: Vec<String>,
    #[serde(default)]
    pub props: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub variants: Vec<String>,
    #[serde(default)]
    pub sizes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryInfo {
    pub name: String,
    pub description: String,
    pub components: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Registry {
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub components: HashMap<String, Component>,
    pub categories: HashMap<String, CategoryInfo>,
    pub requirements: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(rename = "$schema", skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub style: String,
    pub tailwind: TailwindConfig,
    pub aliases: Aliases,
    #[serde(default)]
    pub alias_prefixes: Option<AliasPrefixes>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TailwindConfig {
    pub css: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Aliases {
    pub components: String,
    pub utils: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AliasPrefixes {
    pub components: Option<String>,
    pub utils: Option<String>,
}
