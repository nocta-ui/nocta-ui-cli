use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameworkKind {
    NextJs,
    ViteReact,
    ReactRouter,
    TanstackStart,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppStructure {
    AppRouter,
    PagesRouter,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct FrameworkDetails {
    pub has_config: bool,
    pub has_react_dependency: bool,
    pub has_framework_dependency: bool,
    pub app_structure: Option<AppStructure>,
    pub config_files: Vec<String>,
}

impl FrameworkDetails {
    fn new() -> Self {
        Self {
            has_config: false,
            has_react_dependency: false,
            has_framework_dependency: false,
            app_structure: None,
            config_files: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct FrameworkDetection {
    pub framework: FrameworkKind,
    pub version: Option<String>,
    pub details: FrameworkDetails,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PackageJson {
    #[serde(default)]
    dependencies: HashMap<String, String>,
    #[serde(default)]
    dev_dependencies: HashMap<String, String>,
}

fn read_package_json() -> Option<PackageJson> {
    let data = fs::read_to_string("package.json").ok()?;
    serde_json::from_str(&data).ok()
}

fn merge_dependencies(pkg: &PackageJson) -> HashMap<String, String> {
    pkg.dependencies
        .iter()
        .chain(pkg.dev_dependencies.iter())
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

fn path_exists(path: &str) -> bool {
    Path::new(path).exists()
}

fn find_existing_files(files: &[&str]) -> Vec<String> {
    files
        .iter()
        .filter(|file| path_exists(file))
        .map(|file| (*file).to_string())
        .collect()
}

fn detect_nextjs(deps: &HashMap<String, String>, has_react: bool) -> Option<FrameworkDetection> {
    let next_config_files = [
        "next.config.js",
        "next.config.mjs",
        "next.config.ts",
        "next.config.cjs",
    ];
    let found_configs = find_existing_files(&next_config_files);
    let has_next_dep = deps.contains_key("next");

    if !has_next_dep && found_configs.is_empty() {
        return None;
    }

    let app_router_paths = [
        "app/layout.tsx",
        "app/layout.ts",
        "app/layout.jsx",
        "app/layout.js",
        "src/app/layout.tsx",
        "src/app/layout.ts",
        "src/app/layout.jsx",
        "src/app/layout.js",
    ];

    let pages_router_paths = [
        "pages/_app.tsx",
        "pages/_app.ts",
        "pages/_app.jsx",
        "pages/_app.js",
        "pages/index.tsx",
        "pages/index.ts",
        "pages/index.jsx",
        "pages/index.js",
        "src/pages/_app.tsx",
        "src/pages/_app.ts",
        "src/pages/_app.jsx",
        "src/pages/_app.js",
        "src/pages/index.tsx",
        "src/pages/index.ts",
        "src/pages/index.jsx",
        "src/pages/index.js",
    ];

    let mut app_structure = AppStructure::Unknown;
    if app_router_paths.iter().any(|path| path_exists(path)) {
        app_structure = AppStructure::AppRouter;
    } else if pages_router_paths.iter().any(|path| path_exists(path)) {
        app_structure = AppStructure::PagesRouter;
    }

    Some(FrameworkDetection {
        framework: FrameworkKind::NextJs,
        version: deps.get("next").cloned(),
        details: FrameworkDetails {
            has_config: !found_configs.is_empty(),
            has_react_dependency: has_react,
            has_framework_dependency: has_next_dep,
            app_structure: Some(app_structure),
            config_files: found_configs,
        },
    })
}

fn detect_react_router(
    deps: &HashMap<String, String>,
    has_react: bool,
) -> Option<FrameworkDetection> {
    let config_files = ["react-router.config.ts", "react-router.config.js"];
    let found_configs = find_existing_files(&config_files);

    let has_react_router = deps.contains_key("react-router");
    let has_react_router_dev = deps.contains_key("@react-router/dev");
    let has_remix_run_react = deps.contains_key("@remix-run/react");

    let mut is_framework = false;

    let indicators = [
        "app/routes.ts",
        "app/routes.tsx",
        "app/routes.js",
        "app/routes.jsx",
        "app/root.tsx",
        "app/root.ts",
        "app/root.jsx",
        "app/root.js",
        "app/entry.client.tsx",
        "app/entry.client.ts",
        "app/entry.client.jsx",
        "app/entry.client.js",
        "app/entry.server.tsx",
        "app/entry.server.ts",
        "app/entry.server.jsx",
        "app/entry.server.js",
    ];

    if indicators.iter().any(|path| path_exists(path)) {
        is_framework = true;
    }

    if has_react_router_dev || !found_configs.is_empty() {
        is_framework = true;
    }

    if has_remix_run_react && !path_exists("remix.config.js") && !path_exists("remix.config.ts") {
        is_framework = true;
    }

    if is_framework && has_react {
        let version = deps
            .get("react-router")
            .or_else(|| deps.get("@react-router/dev"))
            .or_else(|| deps.get("@remix-run/react"))
            .cloned();

        return Some(FrameworkDetection {
            framework: FrameworkKind::ReactRouter,
            version,
            details: FrameworkDetails {
                has_config: !found_configs.is_empty(),
                has_react_dependency: has_react,
                has_framework_dependency: has_react_router
                    || has_react_router_dev
                    || has_remix_run_react,
                app_structure: None,
                config_files: found_configs,
            },
        });
    }

    None
}

fn detect_tanstack_start(
    deps: &HashMap<String, String>,
    has_react: bool,
) -> Option<FrameworkDetection> {
    let config_files = [
        "start.config.ts",
        "start.config.js",
        "start.config.mts",
        "start.config.mjs",
        "start.config.cjs",
    ];
    let start_dep_names = [
        "@tanstack/start",
        "@tanstack/start-client",
        "@tanstack/start-server",
        "@tanstack/start-router",
        "@tanstack/react-start",
    ];
    let router_dep_names = [
        "@tanstack/react-router",
        "@tanstack/react-router-server",
        "@tanstack/react-router-devtools",
        "@tanstack/react-router-start",
        "@tanstack/router",
        "@tanstack/router-server",
        "@tanstack/router-devtools",
        "@tanstack/router-vite",
        "@tanstack/react-router-vite",
        "@tanstack/router-plugin",
        "@tanstack/react-router-ssr-query",
    ];
    let has_start_dep = start_dep_names
        .iter()
        .any(|name| deps.contains_key(*name));
    let has_router_dep = router_dep_names
        .iter()
        .any(|name| deps.contains_key(*name));

    let found_configs = find_existing_files(&config_files);
    let indicator_files = [
        "app/routes/__root.tsx",
        "app/routes/__root.ts",
        "app/routes/__root.jsx",
        "app/routes/__root.js",
        "app/routes/__root.client.tsx",
        "app/routes/__root.client.ts",
        "app/routes/__root.client.jsx",
        "app/routes/__root.client.js",
        "app/entry-client.tsx",
        "app/entry-client.ts",
        "app/entry-client.jsx",
        "app/entry-client.js",
        "app/entry-server.tsx",
        "app/entry-server.ts",
        "app/entry-server.jsx",
        "app/entry-server.js",
        "src/routes/__root.tsx",
        "src/routes/__root.ts",
        "src/routes/__root.jsx",
        "src/routes/__root.js",
        "src/routes/__root.client.tsx",
        "src/routes/__root.client.ts",
        "src/routes/__root.client.jsx",
        "src/routes/__root.client.js",
        "src/entry-client.tsx",
        "src/entry-client.ts",
        "src/entry-client.jsx",
        "src/entry-client.js",
        "src/entry-server.tsx",
        "src/entry-server.ts",
        "src/entry-server.jsx",
        "src/entry-server.js",
        "src/router.tsx",
        "src/router.ts",
    ];

    let has_route_indicators = indicator_files.iter().any(|path| path_exists(path));
    let has_routes_dir =
        Path::new("app/routes").is_dir() || Path::new("src/routes").is_dir();
    let has_structure = !found_configs.is_empty() || has_route_indicators || has_routes_dir;

    if !(has_start_dep || (has_structure && has_router_dep)) || !has_react {
        return None;
    }

    let version = deps
        .get("@tanstack/start")
        .or_else(|| deps.get("@tanstack/start-client"))
        .or_else(|| deps.get("@tanstack/start-server"))
        .or_else(|| deps.get("@tanstack/react-router"))
        .or_else(|| deps.get("@tanstack/react-start"))
        .or_else(|| deps.get("@tanstack/router"))
        .cloned();

    Some(FrameworkDetection {
        framework: FrameworkKind::TanstackStart,
        version,
        details: FrameworkDetails {
            has_config: !found_configs.is_empty(),
            has_react_dependency: has_react,
            has_framework_dependency: has_start_dep || has_router_dep,
            app_structure: None,
            config_files: found_configs,
        },
    })
}

fn detect_vite_react(
    deps: &HashMap<String, String>,
    has_react: bool,
) -> Option<FrameworkDetection> {
    let vite_config_files = [
        "vite.config.js",
        "vite.config.ts",
        "vite.config.mjs",
        "vite.config.cjs",
    ];
    let found_configs = find_existing_files(&vite_config_files);

    let has_vite = deps.contains_key("vite");
    if !has_vite && found_configs.is_empty() {
        return None;
    }

    let has_vite_plugin =
        deps.contains_key("@vitejs/plugin-react") || deps.contains_key("@vitejs/plugin-react-swc");

    let mut is_react_project = has_vite_plugin;

    if !is_react_project {
        let indicators = [
            "src/App.tsx",
            "src/App.jsx",
            "src/App.ts",
            "src/App.js",
            "src/main.tsx",
            "src/main.jsx",
            "src/main.ts",
            "src/main.js",
            "src/index.tsx",
            "src/index.jsx",
            "src/index.ts",
            "src/index.js",
        ];

        if indicators.iter().any(|path| path_exists(path)) {
            is_react_project = true;
        }
    }

    if !is_react_project && path_exists("index.html") {
        if let Ok(content) = fs::read_to_string("index.html") {
            let has_root = content.contains("id=\"root\"") || content.contains("id='root'");
            let has_vite_script = content.contains("/src/main.")
                || content.contains("/src/index.")
                || content.contains("type=\"module\"");
            if has_root && has_vite_script {
                is_react_project = true;
            }
        }
    }

    if is_react_project && has_react {
        return Some(FrameworkDetection {
            framework: FrameworkKind::ViteReact,
            version: deps.get("vite").cloned(),
            details: FrameworkDetails {
                has_config: !found_configs.is_empty(),
                has_react_dependency: has_react,
                has_framework_dependency: has_vite,
                app_structure: None,
                config_files: found_configs,
            },
        });
    }

    None
}

pub fn is_type_script_project() -> bool {
    if let Some(pkg) = read_package_json() {
        let deps = merge_dependencies(&pkg);
        if deps.contains_key("typescript") || deps.contains_key("@types/node") {
            return true;
        }
    }

    path_exists("tsconfig.json")
}

pub fn detect_framework() -> FrameworkDetection {
    let pkg = match read_package_json() {
        Some(pkg) => pkg,
        None => {
            return FrameworkDetection {
                framework: FrameworkKind::Unknown,
                version: None,
                details: FrameworkDetails::new(),
            };
        }
    };

    let deps = merge_dependencies(&pkg);
    let has_react = deps.contains_key("react");

    if let Some(detection) = detect_nextjs(&deps, has_react) {
        return detection;
    }

    if let Some(detection) = detect_react_router(&deps, has_react) {
        return detection;
    }

    if let Some(detection) = detect_tanstack_start(&deps, has_react) {
        return detection;
    }

    if let Some(detection) = detect_vite_react(&deps, has_react) {
        return detection;
    }

    if has_react {
        let cra_like = deps.contains_key("react-scripts") || path_exists("public/index.html");

        if cra_like {
            return FrameworkDetection {
                framework: FrameworkKind::Unknown,
                version: None,
                details: FrameworkDetails {
                    has_config: false,
                    has_react_dependency: true,
                    has_framework_dependency: false,
                    app_structure: None,
                    config_files: Vec::new(),
                },
            };
        }
    }

    FrameworkDetection {
        framework: FrameworkKind::Unknown,
        version: None,
        details: FrameworkDetails {
            has_config: false,
            has_react_dependency: has_react,
            has_framework_dependency: false,
            app_structure: None,
            config_files: Vec::new(),
        },
    }
}
