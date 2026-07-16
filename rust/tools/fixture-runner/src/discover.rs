//! Discover and parse every `*.json` under a fixtures root.

use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::error::{RunnerError, RunnerResult};
use crate::model::{parse_fixture, Fixture};

#[derive(Debug, Clone, PartialEq)]
pub struct DiscoveredFixture {
    pub path: PathBuf,
    pub fixture: Fixture,
}

/// Walk `root` recursively, parse every `*.json` as a §5.3 fixture.
pub fn discover_fixtures(root: &Path) -> RunnerResult<Vec<DiscoveredFixture>> {
    if !root.is_dir() {
        return Err(RunnerError::Walk(format!(
            "fixtures root is not a directory: {}",
            root.display()
        )));
    }

    let mut paths: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = match entry {
            Ok(e) => e,
            Err(err) => {
                return Err(RunnerError::Walk(format!("walk error: {err}")));
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        match path.extension().and_then(|ext| ext.to_str()) {
            Some("json") => paths.push(path.to_path_buf()),
            _ => continue,
        }
    }

    paths.sort();

    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        let text = match fs::read_to_string(&path) {
            Ok(t) => t,
            Err(source) => {
                return Err(RunnerError::Io {
                    path: path.clone(),
                    source,
                });
            }
        };
        let raw: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(err) => {
                return Err(RunnerError::InvalidFixture {
                    path: path.clone(),
                    message: format!("invalid JSON: {err}"),
                });
            }
        };
        let fixture = match parse_fixture(&raw) {
            Ok(f) => f,
            Err(err) => {
                return Err(RunnerError::InvalidFixture {
                    path: path.clone(),
                    message: err.to_string(),
                });
            }
        };
        out.push(DiscoveredFixture { path, fixture });
    }

    Ok(out)
}
