use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentFile {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub file_type: String,
    #[serde(default, alias = "workspace", skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
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
    pub dev_dependencies: HashMap<String, String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exports: Option<ExportsConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<WorkspaceConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TailwindConfig {
    pub css: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Aliases {
    #[serde(default)]
    pub components: AliasTarget,
    #[serde(default)]
    pub utils: AliasTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AliasPrefixes {
    pub components: Option<String>,
    pub utils: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportsConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub components: Option<ExportsTargetConfig>,
}

impl ExportsConfig {
    pub fn components(&self) -> Option<&ExportsTargetConfig> {
        self.components.as_ref()
    }

    pub fn components_mut(&mut self) -> Option<&mut ExportsTargetConfig> {
        self.components.as_mut()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportsTargetConfig {
    pub barrel: String,
    #[serde(default)]
    pub strategy: ExportStrategy,
}

impl ExportsTargetConfig {
    pub fn new(barrel: impl Into<String>) -> Self {
        Self {
            barrel: barrel.into(),
            strategy: ExportStrategy::Named,
        }
    }

    pub fn barrel_path(&self) -> &str {
        &self.barrel
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportStrategy {
    Named,
}

impl Default for ExportStrategy {
    fn default() -> Self {
        ExportStrategy::Named
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AliasTarget {
    Path(String),
    Paths {
        filesystem: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        import: Option<String>,
    },
}

impl Default for AliasTarget {
    fn default() -> Self {
        AliasTarget::Path(String::new())
    }
}

impl AliasTarget {
    pub fn filesystem_path(&self) -> &str {
        match self {
            AliasTarget::Path(path) => path,
            AliasTarget::Paths { filesystem, .. } => filesystem,
        }
    }

    pub fn import_alias(&self) -> Option<&str> {
        match self {
            AliasTarget::Path(_) => None,
            AliasTarget::Paths { import, .. } => import.as_deref(),
        }
    }

    pub fn with_paths(filesystem: impl Into<String>, import: Option<String>) -> Self {
        AliasTarget::Paths {
            filesystem: filesystem.into(),
            import,
        }
    }

    pub fn set_import(&mut self, import: Option<String>) {
        match self {
            AliasTarget::Path(path) => {
                let filesystem = path.clone();
                *self = AliasTarget::Paths { filesystem, import };
            }
            AliasTarget::Paths { import: target, .. } => {
                *target = import;
            }
        }
    }
}

impl From<String> for AliasTarget {
    fn from(value: String) -> Self {
        AliasTarget::Path(value)
    }
}

impl From<&str> for AliasTarget {
    fn from(value: &str) -> Self {
        AliasTarget::Path(value.to_string())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceKind {
    App,
    Ui,
    Library,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLink {
    pub kind: WorkspaceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_name: Option<String>,
    pub root: String,
    pub config: String,
}

fn workspace_root_default() -> String {
    ".".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    pub kind: WorkspaceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_name: Option<String>,
    #[serde(default = "workspace_root_default")]
    pub root: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub linked_workspaces: Vec<WorkspaceLink>,
}
