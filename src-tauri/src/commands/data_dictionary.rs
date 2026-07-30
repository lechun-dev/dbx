use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use tauri::State;

#[derive(Clone)]
pub struct DataDictionaryStorageState {
    pub data_dir: PathBuf,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDictionaryMarkdownFile {
    pub schema: Option<String>,
    pub table: String,
    pub content: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDictionaryMarkdownSyncRequest {
    pub connection_id: String,
    pub database: String,
    pub database_type: String,
    pub updated_at: i64,
    pub files: Vec<DataDictionaryMarkdownFile>,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DataDictionaryManifest {
    database: String,
    database_type: String,
    updated_at: i64,
    files: Vec<String>,
}

#[tauri::command]
pub async fn sync_ai_data_dictionary_markdown(
    state: State<'_, DataDictionaryStorageState>,
    request: DataDictionaryMarkdownSyncRequest,
) -> Result<(), String> {
    let data_dir = state.data_dir.clone();
    tokio::task::spawn_blocking(move || sync_markdown_blocking(&data_dir, request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn clear_ai_data_dictionary_markdown(
    state: State<'_, DataDictionaryStorageState>,
    connection_id: String,
) -> Result<(), String> {
    let data_dir = state.data_dir.clone();
    tokio::task::spawn_blocking(move || clear_markdown_blocking(&data_dir, &connection_id))
        .await
        .map_err(|error| error.to_string())?
}

fn sync_markdown_blocking(
    data_dir: &Path,
    request: DataDictionaryMarkdownSyncRequest,
) -> Result<(), String> {
    let relative_root = PathBuf::from("data-dictionary")
        .join(readable_hashed_segment(&request.connection_id))
        .join(readable_hashed_segment(&request.database));
    reject_symlink_components(data_dir, &relative_root)?;
    let root = data_dir.join(&relative_root);
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    reject_symlink_components(data_dir, &relative_root)?;

    let previous = read_manifest(&root);
    let mut written_files = Vec::with_capacity(request.files.len());
    let mut used_paths = HashSet::new();
    for file in request.files {
        let schema = file
            .schema
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("_default");
        let relative = unique_relative_path(&used_paths, schema, &file.table);
        reject_symlink_components(&root, &relative)?;
        let path = root.join(&relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        reject_symlink_components(&root, &relative)?;
        // 2026-07-29 coder(lq): Periodic reconciliation sends the complete snapshot,
        // so preserve unchanged Markdown files and their modification times.
        write_if_changed(&path, file.content.as_bytes())?;
        used_paths.insert(relative.clone());
        written_files.push(path_string(&relative));
    }

    // 2026-07-29 coder(lq): Only files recorded by DBX's previous manifest may be
    // removed, so a user's own notes under the dictionary directory are preserved.
    for relative in previous.files {
        let normalized = PathBuf::from(&relative);
        if !is_safe_relative_path(&normalized) || used_paths.contains(&normalized) {
            continue;
        }
        if reject_symlink_components(&root, &normalized).is_err() {
            continue;
        }
        let path = root.join(&normalized);
        if path.is_file() {
            std::fs::remove_file(&path).map_err(|error| error.to_string())?;
            remove_empty_parent_dirs(&root, path.parent());
        }
    }

    written_files.sort();
    let manifest = DataDictionaryManifest {
        database: request.database,
        database_type: request.database_type,
        updated_at: request.updated_at,
        files: written_files,
    };
    let json = serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?;
    std::fs::write(root.join("manifest.json"), json).map_err(|error| error.to_string())
}

fn clear_markdown_blocking(data_dir: &Path, connection_id: &str) -> Result<(), String> {
    let relative_root = PathBuf::from("data-dictionary").join(readable_hashed_segment(connection_id));
    reject_symlink_components(data_dir, &relative_root)?;
    let connection_root = data_dir.join(relative_root);
    let Ok(entries) = std::fs::read_dir(&connection_root) else {
        return Ok(());
    };

    // 2026-07-29 coder(lq): Connection invalidation removes only files owned by
    // DBX manifests; personal notes beside generated dictionaries must survive.
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().map_err(|error| error.to_string())?.is_dir() {
            continue;
        }
        let database_root = entry.path();
        let manifest = read_manifest(&database_root);
        for relative in manifest.files {
            let normalized = PathBuf::from(relative);
            if !is_safe_relative_path(&normalized)
                || reject_symlink_components(&database_root, &normalized).is_err()
            {
                continue;
            }
            let path = database_root.join(normalized);
            if path.is_file() {
                std::fs::remove_file(&path).map_err(|error| error.to_string())?;
                remove_empty_parent_dirs(&database_root, path.parent());
            }
        }
        let manifest_path = database_root.join("manifest.json");
        if manifest_path.is_file() {
            std::fs::remove_file(&manifest_path).map_err(|error| error.to_string())?;
        }
        remove_empty_parent_dirs(&connection_root, Some(&database_root));
    }
    Ok(())
}

fn is_safe_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn reject_symlink_components(root: &Path, relative: &Path) -> Result<(), String> {
    if !is_safe_relative_path(relative) {
        return Err("unsafe data dictionary path".to_string());
    }
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err("unsafe data dictionary path".to_string());
        };
        current.push(segment);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("data dictionary path contains a symbolic link".to_string());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn read_manifest(root: &Path) -> DataDictionaryManifest {
    std::fs::read_to_string(root.join("manifest.json"))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn unique_relative_path(used: &HashSet<PathBuf>, schema: &str, table: &str) -> PathBuf {
    let dir = PathBuf::from("schema").join(readable_hashed_segment(schema));
    let base = readable_hashed_segment(table);
    let mut candidate = dir.join(format!("{base}.md"));
    let mut suffix = 2;
    while used.contains(&candidate) {
        candidate = dir.join(format!("{base}-{suffix}.md"));
        suffix += 1;
    }
    candidate
}

fn readable_hashed_segment(value: &str) -> String {
    let readable = value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .chars()
        .take(80)
        .collect::<String>();
    let readable = if readable.is_empty() {
        "unnamed".to_string()
    } else {
        readable
    };
    format!("{readable}--{:016x}", stable_hash(value.as_bytes()))
}

fn stable_hash(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn write_if_changed(path: &Path, content: &[u8]) -> Result<bool, String> {
    match std::fs::read(path) {
        Ok(existing) if existing == content => Ok(false),
        Ok(_) => {
            std::fs::write(path, content).map_err(|error| error.to_string())?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::write(path, content).map_err(|error| error.to_string())?;
            Ok(true)
        }
        Err(error) => Err(error.to_string()),
    }
}

fn remove_empty_parent_dirs(root: &Path, parent: Option<&Path>) {
    let Some(dir) = parent else {
        return;
    };
    if dir == root {
        return;
    }
    if std::fs::remove_dir(dir).is_ok() {
        remove_empty_parent_dirs(root, dir.parent());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_is_readable_stable_and_cannot_escape() {
        let value = readable_hashed_segment("../../customers/name");
        assert!(!value.contains('/'));
        assert!(!value.contains('\\'));
        assert_eq!(value, readable_hashed_segment("../../customers/name"));
    }

    #[test]
    fn manifest_paths_must_stay_below_dictionary_root() {
        assert!(is_safe_relative_path(Path::new("schema/public/users.md")));
        assert!(!is_safe_relative_path(Path::new("../users.md")));
        assert!(!is_safe_relative_path(Path::new("/tmp/users.md")));
    }

    #[test]
    fn unchanged_markdown_is_not_rewritten() {
        let path = std::env::temp_dir().join(format!(
            "dbx-data-dictionary-write-test-{}.md",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);

        assert_eq!(write_if_changed(&path, b"# users").unwrap(), true);
        assert_eq!(write_if_changed(&path, b"# users").unwrap(), false);
        assert_eq!(write_if_changed(&path, b"# customers").unwrap(), true);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# customers");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn sync_removes_only_old_managed_files() {
        let root = std::env::temp_dir().join(format!(
            "dbx-data-dictionary-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let state_dir = root.join("state");
        let request = |files: Vec<DataDictionaryMarkdownFile>| DataDictionaryMarkdownSyncRequest {
            connection_id: "connection".to_string(),
            database: "app".to_string(),
            database_type: "mysql".to_string(),
            updated_at: 1,
            files,
        };
        sync_markdown_blocking(
            &state_dir,
            request(vec![DataDictionaryMarkdownFile {
                schema: None,
                table: "users".to_string(),
                content: "# users".to_string(),
            }]),
        )
        .unwrap();
        let dictionary_root = state_dir
            .join("data-dictionary")
            .join(readable_hashed_segment("connection"))
            .join(readable_hashed_segment("app"));
        std::fs::write(dictionary_root.join("my-notes.md"), "keep").unwrap();

        sync_markdown_blocking(&state_dir, request(vec![])).unwrap();
        assert!(dictionary_root.join("my-notes.md").exists());
        assert!(read_manifest(&dictionary_root).files.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn connection_clear_preserves_personal_notes() {
        let root = std::env::temp_dir().join(format!(
            "dbx-data-dictionary-clear-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let state_dir = root.join("state");
        sync_markdown_blocking(
            &state_dir,
            DataDictionaryMarkdownSyncRequest {
                connection_id: "connection".to_string(),
                database: "app".to_string(),
                database_type: "mysql".to_string(),
                updated_at: 1,
                files: vec![DataDictionaryMarkdownFile {
                    schema: None,
                    table: "users".to_string(),
                    content: "# users".to_string(),
                }],
            },
        )
        .unwrap();
        let dictionary_root = state_dir
            .join("data-dictionary")
            .join(readable_hashed_segment("connection"))
            .join(readable_hashed_segment("app"));
        std::fs::write(dictionary_root.join("my-notes.md"), "keep").unwrap();

        clear_markdown_blocking(&state_dir, "connection").unwrap();
        assert!(dictionary_root.join("my-notes.md").exists());
        assert!(!dictionary_root.join("manifest.json").exists());
        assert!(!dictionary_root.join("schema").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
