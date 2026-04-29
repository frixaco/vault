use std::collections::HashSet;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_void};
use std::path::PathBuf;
use std::ptr;
use std::time::Duration;

use fff_search::{
    parse_grep_query, FFFMode, FilePicker, FilePickerOptions, FrecencyTracker, FuzzySearchOptions,
    GrepMode, GrepSearchOptions, PaginationArgs, QueryParser, QueryTracker, SharedFrecency,
    SharedPicker, SharedQueryTracker,
};
use serde::Serialize;

pub mod files;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchItem {
    path: String,
    name: String,
    directory: String,
    score: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    items: Vec<SearchItem>,
    total_files: usize,
    total_matched: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum SearchScope {
    All,
    Title,
    Content,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchJump {
    line_content: String,
    line_number: u64,
    match_end: usize,
    match_start: usize,
    query: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TitleSearchResult {
    directory: String,
    exact: bool,
    id: String,
    note_path: String,
    title: String,
    #[serde(rename = "type")]
    result_type: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentSearchResult {
    directory: String,
    id: String,
    jump: SearchJump,
    note_path: String,
    snippet: String,
    title: String,
    #[serde(rename = "type")]
    result_type: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteSearchResponse {
    best: Vec<serde_json::Value>,
    content: Vec<ContentSearchResult>,
    query: String,
    scope: SearchScope,
    title: Vec<TitleSearchResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    is_scanning: bool,
    scanned_files_count: usize,
}

struct VaultSearch {
    base_path: PathBuf,
    picker: SharedPicker,
    query_tracker: SharedQueryTracker,
}

impl VaultSearch {
    fn new(base_path: String, data_path: String) -> Result<Self, String> {
        let base_path_buf = PathBuf::from(&base_path);
        let data_path_buf = PathBuf::from(data_path);

        std::fs::create_dir_all(&data_path_buf).map_err(|error| error.to_string())?;

        let picker = SharedPicker::default();
        let frecency = SharedFrecency::default();
        let query_tracker = SharedQueryTracker::default();

        frecency
            .init(
                FrecencyTracker::new(data_path_buf.join("fff-frecency.mdb"), false)
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
        query_tracker
            .init(
                QueryTracker::new(data_path_buf.join("fff-history.mdb"), false)
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;

        FilePicker::new_with_shared_state(
            picker.clone(),
            frecency,
            FilePickerOptions {
                base_path,
                mode: FFFMode::Ai,
                watch: true,
                ..Default::default()
            },
        )
        .map_err(|error| error.to_string())?;

        Ok(Self {
            base_path: base_path_buf,
            picker,
            query_tracker,
        })
    }

    fn wait_for_scan(&self, timeout_ms: u64) -> bool {
        self.picker.wait_for_scan(Duration::from_millis(timeout_ms))
    }

    fn progress(&self) -> Result<ScanProgress, String> {
        let guard = self.picker.read().map_err(|error| error.to_string())?;
        let picker = guard.as_ref().ok_or("fff picker is not initialized")?;

        let progress = picker.get_scan_progress();

        Ok(ScanProgress {
            is_scanning: progress.is_scanning,
            scanned_files_count: progress.scanned_files_count,
        })
    }

    fn search(&self, query: String, limit: usize) -> Result<SearchResponse, String> {
        let response = self.search_notes(query, SearchScope::All)?;
        let mut seen = HashSet::new();
        let mut items = Vec::new();

        for note_path in response
            .title
            .iter()
            .map(|result| result.note_path.as_str())
            .chain(
                response
                    .content
                    .iter()
                    .map(|result| result.note_path.as_str()),
            )
        {
            if seen.insert(note_path.to_string()) {
                items.push(search_item_from_note_path(note_path, 0));
                if items.len() >= limit.clamp(1, 200) {
                    break;
                }
            }
        }

        Ok(SearchResponse {
            total_files: self.total_files()?,
            total_matched: items.len(),
            items,
        })
    }

    fn search_notes(
        &self,
        query: String,
        fallback_scope: SearchScope,
    ) -> Result<NoteSearchResponse, String> {
        let parsed = parse_note_search_input(&query, fallback_scope);
        let title = if matches!(parsed.scope, SearchScope::Content) {
            Vec::new()
        } else {
            self.collect_title_results(&parsed.query)?
        };
        let content = if matches!(parsed.scope, SearchScope::Title) {
            Vec::new()
        } else {
            self.collect_content_results(&parsed.query)?
        };

        Ok(NoteSearchResponse {
            best: Vec::new(),
            content,
            query: parsed.query,
            scope: parsed.scope,
            title,
        })
    }

    fn collect_title_results(&self, query: &str) -> Result<Vec<TitleSearchResult>, String> {
        let guard = self.picker.read().map_err(|error| error.to_string())?;
        let picker = guard.as_ref().ok_or("fff picker is not initialized")?;
        let query_tracker_guard = self
            .query_tracker
            .read()
            .map_err(|error| error.to_string())?;
        let trimmed_query = query.trim();
        if trimmed_query.is_empty() {
            return Ok(Vec::new());
        }

        let parser = QueryParser::default();
        let parsed = parser.parse(trimmed_query);
        let title_results = picker.fuzzy_search(
            &parsed,
            query_tracker_guard.as_ref(),
            FuzzySearchOptions {
                max_threads: 0,
                current_file: None,
                project_path: Some(&self.base_path),
                pagination: PaginationArgs {
                    offset: 0,
                    limit: TITLE_SCAN_LIMIT,
                },
                ..Default::default()
            },
        );

        let query_words = normalized_search_words(trimmed_query);
        let mut seen = HashSet::new();
        let mut results = Vec::new();

        for item in &title_results.items {
            let path = item.relative_path(picker);
            if !is_markdown_path(&path) || !matches_title_query(&path, &query_words) {
                continue;
            }

            let Some(note_path) = normalize_note_file_path(&path) else {
                continue;
            };
            if seen.insert(note_path.clone()) {
                results.push(create_title_result(&note_path, trimmed_query));
                if results.len() >= TITLE_RESULT_LIMIT {
                    break;
                }
            }
        }

        Ok(results)
    }

    fn collect_content_results(&self, query: &str) -> Result<Vec<ContentSearchResult>, String> {
        let trimmed_query = query.trim();
        if trimmed_query.is_empty() {
            return Ok(Vec::new());
        }

        let guard = self.picker.read().map_err(|error| error.to_string())?;
        let picker = guard.as_ref().ok_or("fff picker is not initialized")?;
        let grep_query = format!("*.md {trimmed_query}");
        let grep_result = picker.grep(
            &parse_grep_query(&grep_query),
            &GrepSearchOptions {
                max_matches_per_file: 2,
                page_limit: CONTENT_RESULT_LIMIT * 2,
                mode: GrepMode::PlainText,
                smart_case: true,
                time_budget_ms: 80,
                ..Default::default()
            },
        );

        let mut seen = HashSet::new();
        let mut results = Vec::new();

        for grep_match in &grep_result.matches {
            let Some(item) = grep_result.files.get(grep_match.file_index) else {
                continue;
            };
            let relative_path = item.relative_path(picker);
            let Some(note_path) = normalize_note_file_path(&relative_path) else {
                continue;
            };
            if grep_match.line_content.trim().is_empty() {
                continue;
            }

            let (match_start, match_end) = grep_match
                .match_byte_offsets
                .first()
                .map(|(start, end)| (*start as usize, *end as usize))
                .unwrap_or_else(|| {
                    get_match_range(grep_match.col, trimmed_query, &grep_match.line_content)
                });
            let key = format!("{note_path}:{}:{match_start}", grep_match.line_number);
            if !seen.insert(key) {
                continue;
            }

            results.push(create_content_result(
                &note_path,
                SearchJump {
                    line_content: grep_match.line_content.clone(),
                    line_number: grep_match.line_number,
                    match_end,
                    match_start,
                    query: trimmed_query.to_string(),
                },
            ));
            if results.len() >= CONTENT_RESULT_LIMIT {
                break;
            }
        }

        Ok(results)
    }

    fn track_selection(&self, query: String, note_path: String) -> Result<(), String> {
        let parsed = parse_note_search_input(&query, SearchScope::All);
        if parsed.query.trim().is_empty() {
            return Ok(());
        }

        let normalized_path =
            normalize_note_path(&note_path).ok_or_else(|| "invalid note path".to_string())?;
        let file_path = self.base_path.join(format!("{normalized_path}.md"));
        let mut query_tracker_guard = self
            .query_tracker
            .write()
            .map_err(|error| error.to_string())?;
        let query_tracker = query_tracker_guard
            .as_mut()
            .ok_or("fff query tracker is not initialized")?;

        query_tracker
            .track_query_completion(&parsed.query, &self.base_path, &file_path)
            .map_err(|error| error.to_string())
    }

    fn total_files(&self) -> Result<usize, String> {
        let guard = self.picker.read().map_err(|error| error.to_string())?;
        let picker = guard.as_ref().ok_or("fff picker is not initialized")?;
        Ok(picker.get_files().len())
    }
}

const TITLE_RESULT_LIMIT: usize = 80;
const TITLE_SCAN_LIMIT: usize = 480;
const CONTENT_RESULT_LIMIT: usize = 24;

struct ParsedSearchInput {
    query: String,
    scope: SearchScope,
}

fn parse_note_search_input(query: &str, fallback_scope: SearchScope) -> ParsedSearchInput {
    let trimmed_query = query.trim();
    let lower_query = trimmed_query.to_lowercase();

    if lower_query.starts_with("in:content ") {
        return ParsedSearchInput {
            query: trimmed_query["in:content ".len()..].trim().to_string(),
            scope: SearchScope::Content,
        };
    }
    if lower_query.starts_with("in:title ") {
        return ParsedSearchInput {
            query: trimmed_query["in:title ".len()..].trim().to_string(),
            scope: SearchScope::Title,
        };
    }
    if let Some(query) = trimmed_query.strip_prefix('/') {
        return ParsedSearchInput {
            query: query.trim().to_string(),
            scope: SearchScope::Content,
        };
    }
    if trimmed_query.starts_with('#') {
        return ParsedSearchInput {
            query: trimmed_query.to_string(),
            scope: SearchScope::Content,
        };
    }

    ParsedSearchInput {
        query: trimmed_query.to_string(),
        scope: fallback_scope,
    }
}

fn parse_search_scope(scope: &str) -> Result<SearchScope, String> {
    match scope {
        "all" => Ok(SearchScope::All),
        "title" => Ok(SearchScope::Title),
        "content" => Ok(SearchScope::Content),
        _ => Err(format!("unknown search scope: {scope}")),
    }
}

fn create_title_result(note_path: &str, query: &str) -> TitleSearchResult {
    let (directory, title) = get_note_display_parts(note_path);
    let normalized_query = normalize_search_text(query);
    let normalized_title = normalize_search_text(&title);

    TitleSearchResult {
        directory,
        exact: !normalized_query.is_empty() && normalized_title == normalized_query,
        id: format!("title:{note_path}"),
        note_path: note_path.to_string(),
        title,
        result_type: "title",
    }
}

fn create_content_result(note_path: &str, jump: SearchJump) -> ContentSearchResult {
    let (directory, title) = get_note_display_parts(note_path);

    ContentSearchResult {
        directory,
        id: format!(
            "content:{note_path}:{}:{}",
            jump.line_number, jump.match_start
        ),
        snippet: jump.line_content.clone(),
        jump,
        note_path: note_path.to_string(),
        title,
        result_type: "content",
    }
}

fn get_note_display_parts(note_path: &str) -> (String, String) {
    let mut segments = note_path.rsplitn(2, '/');
    let title = segments.next().unwrap_or(note_path).to_string();
    let directory = segments.next().unwrap_or("").to_string();

    (directory, title)
}

fn search_item_from_note_path(note_path: &str, score: i32) -> SearchItem {
    let (directory, title) = get_note_display_parts(note_path);
    let name = format!("{title}.md");
    let path = if directory.is_empty() {
        name.clone()
    } else {
        format!("{directory}/{name}")
    };

    SearchItem {
        directory,
        name,
        path,
        score,
    }
}

fn normalize_note_file_path(path: &str) -> Option<String> {
    if !is_markdown_path(path) {
        return None;
    }

    normalize_note_path(strip_markdown_extension(path))
}

fn normalize_note_path(path: &str) -> Option<String> {
    let normalized = path
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty())
        .map(str::trim)
        .collect::<Vec<_>>();

    if normalized
        .iter()
        .any(|segment| *segment == "." || *segment == "..")
    {
        return None;
    }

    Some(normalized.join("/"))
}

fn get_match_range(match_start: usize, query: &str, line_content: &str) -> (usize, usize) {
    let normalized_line = line_content.to_lowercase();
    let normalized_query = query.trim().to_lowercase();
    if normalized_query.is_empty() {
        return (match_start, match_start);
    }

    let direct_index = normalized_line
        .get(match_start.saturating_sub(1)..)
        .and_then(|line| line.find(&normalized_query))
        .map(|index| index + match_start.saturating_sub(1));

    match direct_index {
        Some(index) => (index, index + normalized_query.len()),
        None => (
            match_start,
            line_content.len().min(match_start + normalized_query.len()),
        ),
    }
}

fn json_void_result(result: Result<(), String>) -> *mut c_char {
    json_result(result.map(|()| serde_json::Value::Null))
}

fn json_note_search_result(
    handle: *mut c_void,
    query: *const c_char,
    scope: *const c_char,
) -> *mut c_char {
    json_result(with_search(handle, |search| {
        search.search_notes(
            c_string_to_string(query)?,
            parse_search_scope(&c_string_to_string(scope)?)?,
        )
    }))
}

fn json_track_selection_result(
    handle: *mut c_void,
    query: *const c_char,
    note_path: *const c_char,
) -> *mut c_char {
    json_void_result(with_search(handle, |search| {
        search.track_selection(c_string_to_string(query)?, c_string_to_string(note_path)?)
    }))
}

fn matches_title_query(path: &str, query_words: &[String]) -> bool {
    if query_words.is_empty() {
        return true;
    }

    let filename = path.split('/').next_back().unwrap_or(path);
    let title = strip_markdown_extension(filename);
    let normalized_title = normalize_search_text(title);
    let normalized_path = normalize_search_text(strip_markdown_extension(path));

    query_words.iter().all(|word| {
        normalized_title.contains(word.as_str()) || normalized_path.contains(word.as_str())
    })
}

fn normalized_search_words(value: &str) -> Vec<String> {
    normalize_search_text(value)
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

fn normalize_search_text(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());

    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            normalized.push(character);
        } else {
            normalized.push(' ');
        }
    }

    normalized.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_markdown_path(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".md")
}

fn strip_markdown_extension(path: &str) -> &str {
    path.strip_suffix(".md")
        .or_else(|| path.strip_suffix(".MD"))
        .unwrap_or(path)
}

fn c_string_to_string(value: *const c_char) -> Result<String, String> {
    if value.is_null() {
        return Err("received null string".to_string());
    }

    unsafe { CStr::from_ptr(value) }
        .to_str()
        .map(str::to_owned)
        .map_err(|error| error.to_string())
}

fn string_to_c(value: String) -> *mut c_char {
    match CString::new(value) {
        Ok(value) => value.into_raw(),
        Err(_) => ptr::null_mut(),
    }
}

fn json_result<T: Serialize>(result: Result<T, String>) -> *mut c_char {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Envelope<T> {
        ok: bool,
        value: Option<T>,
        error: Option<String>,
    }

    let envelope = match result {
        Ok(value) => Envelope {
            ok: true,
            value: Some(value),
            error: None,
        },
        Err(error) => Envelope {
            ok: false,
            value: None,
            error: Some(error),
        },
    };

    string_to_c(
        serde_json::to_string(&envelope)
            .unwrap_or_else(|error| format!(r#"{{"ok":false,"value":null,"error":"{error}"}}"#)),
    )
}

fn with_search<T, F>(handle: *mut c_void, operation: F) -> Result<T, String>
where
    F: FnOnce(&VaultSearch) -> Result<T, String>,
{
    if handle.is_null() {
        return Err("fff search handle is null".to_string());
    }

    let search = unsafe { &*(handle as *mut VaultSearch) };
    operation(search)
}

#[no_mangle]
pub extern "C" fn vault_shared_search_create(
    base_path: *const c_char,
    data_path: *const c_char,
) -> *mut c_void {
    let result = c_string_to_string(base_path)
        .and_then(|base_path| Ok((base_path, c_string_to_string(data_path)?)))
        .and_then(|(base_path, data_path)| VaultSearch::new(base_path, data_path));

    match result {
        Ok(search) => Box::into_raw(Box::new(search)) as *mut c_void,
        Err(error) => {
            vault_shared_set_last_error(error);
            ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "C" fn vault_shared_search_destroy(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }

    unsafe {
        drop(Box::from_raw(handle as *mut VaultSearch));
    }
}

#[no_mangle]
pub extern "C" fn vault_shared_search_wait_for_scan(handle: *mut c_void, timeout_ms: u64) -> bool {
    with_search(handle, |search| Ok(search.wait_for_scan(timeout_ms))).unwrap_or(false)
}

#[no_mangle]
pub extern "C" fn vault_shared_search_progress_json(handle: *mut c_void) -> *mut c_char {
    json_result(with_search(handle, |search| search.progress()))
}

#[no_mangle]
pub extern "C" fn vault_shared_search_files_json(
    handle: *mut c_void,
    query: *const c_char,
    limit: u32,
) -> *mut c_char {
    json_result(with_search(handle, |search| {
        search.search(c_string_to_string(query)?, limit as usize)
    }))
}

#[no_mangle]
pub extern "C" fn vault_shared_note_search_json(
    handle: *mut c_void,
    query: *const c_char,
    scope: *const c_char,
) -> *mut c_char {
    json_note_search_result(handle, query, scope)
}

#[no_mangle]
pub extern "C" fn vault_shared_search_track_selection_json(
    handle: *mut c_void,
    query: *const c_char,
    note_path: *const c_char,
) -> *mut c_char {
    json_track_selection_result(handle, query, note_path)
}

#[no_mangle]
pub extern "C" fn vault_shared_free_string(value: *mut c_char) {
    if value.is_null() {
        return;
    }

    unsafe {
        drop(CString::from_raw(value));
    }
}

thread_local! {
    static LAST_ERROR: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

fn vault_shared_set_last_error(error: String) {
    LAST_ERROR.with(|last_error| {
        *last_error.borrow_mut() = Some(error);
    });
}

#[no_mangle]
pub extern "C" fn vault_shared_take_last_error() -> *mut c_char {
    LAST_ERROR.with(|last_error| {
        string_to_c(
            last_error
                .borrow_mut()
                .take()
                .unwrap_or_else(|| "unknown fff-search error".to_string()),
        )
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn search_filters_title_results_to_notes_matching_all_words() {
        let fixture = SearchFixture::new("title-filter");
        fixture.write_note(
            "Clippings/How to learn LLMs.md",
            "# How to learn LLMs\n\nRoadmap from zero to fine-tuning.",
        );
        fixture.write_note(
            "Clippings/How JavaScript works.md",
            "# How JavaScript works\n\nRuntime notes.",
        );
        fixture.write_note(
            "Personal/Learning goals.md",
            "# Learning goals\n\nPractice.",
        );

        let search = fixture.search();
        let response = search.search("how to learn".to_string(), 24).unwrap();
        let paths = response_paths(&response);

        assert_eq!(paths, vec!["Clippings/How to learn LLMs.md"]);
    }

    #[test]
    fn search_includes_markdown_content_matches() {
        let fixture = SearchFixture::new("content-search");
        fixture.write_note(
            "Drafts/Untitled note.md",
            "# Untitled note\n\nStart writing. Use bold, italic, and links.",
        );
        fixture.write_note(
            "Clippings/How to learn LLMs.md",
            "# How to learn LLMs\n\nRoadmap from zero to fine-tuning.",
        );

        let search = fixture.search();
        let response = search.search("start writing".to_string(), 24).unwrap();
        let paths = response_paths(&response);

        assert_eq!(paths, vec!["Drafts/Untitled note.md"]);
    }

    #[test]
    fn note_search_returns_desktop_title_and_content_buckets() {
        let fixture = SearchFixture::new("note-search");
        fixture.write_note(
            "Clippings/How to learn LLMs.md",
            "# How to learn LLMs\n\nRoadmap from zero to fine-tuning.",
        );
        fixture.write_note(
            "Drafts/Untitled note.md",
            "# Untitled note\n\nStart writing. Use bold, italic, and links.",
        );

        let search = fixture.search();
        let response = search
            .search_notes("start writing".to_string(), SearchScope::All)
            .unwrap();

        assert_eq!(response.title.len(), 0);
        assert_eq!(response.content.len(), 1);
        assert_eq!(response.content[0].note_path, "Drafts/Untitled note");
        assert_eq!(response.content[0].jump.query, "start writing");
    }

    #[test]
    fn note_search_respects_explicit_title_scope() {
        let fixture = SearchFixture::new("title-scope");
        fixture.write_note(
            "Clippings/How to learn LLMs.md",
            "# How to learn LLMs\n\nRoadmap from zero to fine-tuning.",
        );

        let search = fixture.search();
        let response = search
            .search_notes("in:title how to learn".to_string(), SearchScope::All)
            .unwrap();

        assert_eq!(response.title.len(), 1);
        assert_eq!(response.content.len(), 0);
        assert_eq!(response.scope, SearchScope::Title);
    }

    struct SearchFixture {
        root: PathBuf,
        notes: PathBuf,
        data: PathBuf,
    }

    impl SearchFixture {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "vault-shared-{name}-{}-{unique}",
                std::process::id()
            ));
            let notes = root.join("notes");
            let data = root.join("data");

            fs::create_dir_all(&notes).unwrap();
            fs::create_dir_all(&data).unwrap();

            Self { root, notes, data }
        }

        fn write_note(&self, relative_path: &str, contents: &str) {
            let path = self.notes.join(relative_path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, contents).unwrap();
        }

        fn search(&self) -> VaultSearch {
            let search = VaultSearch::new(
                self.notes.to_string_lossy().into_owned(),
                self.data.to_string_lossy().into_owned(),
            )
            .unwrap();
            assert!(search.wait_for_scan(5000));
            search
        }
    }

    impl Drop for SearchFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn response_paths(response: &SearchResponse) -> Vec<&str> {
        response
            .items
            .iter()
            .map(|item| item.path.as_str())
            .collect()
    }
}

#[cfg(target_os = "android")]
mod android {
    use std::ffi::CString;
    use std::os::raw::c_void;

    use jni::objects::{JObject, JString};
    use jni::sys::{jboolean, jint, jlong, jstring, JNI_ERR, JNI_VERSION_1_6};
    use jni::{JNIEnv, JavaVM, NativeMethod};

    use super::{
        c_string_to_string, vault_shared_free_string, vault_shared_note_search_json,
        vault_shared_search_create, vault_shared_search_destroy, vault_shared_search_files_json,
        vault_shared_search_progress_json, vault_shared_search_track_selection_json,
        vault_shared_search_wait_for_scan, vault_shared_take_last_error,
    };

    #[no_mangle]
    pub extern "system" fn JNI_OnLoad(vm: *mut jni::sys::JavaVM, _reserved: *mut c_void) -> jint {
        match register_android_natives(vm) {
            Ok(()) => JNI_VERSION_1_6,
            Err(error) => {
                vault_shared_set_android_load_error(error);
                JNI_ERR
            }
        }
    }

    fn register_android_natives(vm: *mut jni::sys::JavaVM) -> Result<(), String> {
        let vm = unsafe { JavaVM::from_raw(vm) }.map_err(|error| error.to_string())?;
        let mut env = vm
            .get_env()
            .or_else(|_| vm.attach_current_thread_permanently())
            .map_err(|error| error.to_string())?;
        let class = env
            .find_class("expo/modules/vaultshared/VaultSharedModule")
            .map_err(|error| error.to_string())?;

        env.register_native_methods(
            class,
            &[
                NativeMethod {
                    name: "nativeCreate".into(),
                    sig: "(Ljava/lang/String;Ljava/lang/String;)J".into(),
                    fn_ptr: native_create as *mut c_void,
                },
                NativeMethod {
                    name: "nativeDestroy".into(),
                    sig: "(J)V".into(),
                    fn_ptr: native_destroy as *mut c_void,
                },
                NativeMethod {
                    name: "nativeWaitForScan".into(),
                    sig: "(JJ)Z".into(),
                    fn_ptr: native_wait_for_scan as *mut c_void,
                },
                NativeMethod {
                    name: "nativeProgressJson".into(),
                    sig: "(J)Ljava/lang/String;".into(),
                    fn_ptr: native_progress_json as *mut c_void,
                },
                NativeMethod {
                    name: "nativeSearchFilesJson".into(),
                    sig: "(JLjava/lang/String;J)Ljava/lang/String;".into(),
                    fn_ptr: native_search_files_json as *mut c_void,
                },
                NativeMethod {
                    name: "nativeNoteSearchJson".into(),
                    sig: "(JLjava/lang/String;Ljava/lang/String;)Ljava/lang/String;".into(),
                    fn_ptr: native_note_search_json as *mut c_void,
                },
                NativeMethod {
                    name: "nativeSearchTrackSelectionJson".into(),
                    sig: "(JLjava/lang/String;Ljava/lang/String;)Ljava/lang/String;".into(),
                    fn_ptr: native_search_track_selection_json as *mut c_void,
                },
                NativeMethod {
                    name: "nativeTakeLastError".into(),
                    sig: "()Ljava/lang/String;".into(),
                    fn_ptr: native_take_last_error as *mut c_void,
                },
            ],
        )
        .map_err(|error| error.to_string())
    }

    fn vault_shared_set_android_load_error(error: String) {
        super::vault_shared_set_last_error(error);
    }

    fn jstring_to_c(env: &mut JNIEnv, value: JString) -> CString {
        let value: String = env.get_string(&value).expect("valid Java string").into();
        CString::new(value).expect("Java strings cannot contain interior null bytes")
    }

    unsafe fn c_to_jstring(env: &mut JNIEnv, value: *mut std::os::raw::c_char) -> jstring {
        if value.is_null() {
            return env.new_string("").expect("empty Java string").into_raw();
        }

        let string = c_string_to_string(value)
            .unwrap_or_else(|error| format!(r#"{{"ok":false,"value":null,"error":"{error}"}}"#));
        vault_shared_free_string(value);
        env.new_string(string)
            .expect("valid Java string")
            .into_raw()
    }

    extern "system" fn native_create(
        mut env: JNIEnv,
        _this: JObject,
        base_path: JString,
        data_path: JString,
    ) -> jlong {
        let base_path = jstring_to_c(&mut env, base_path);
        let data_path = jstring_to_c(&mut env, data_path);

        vault_shared_search_create(base_path.as_ptr(), data_path.as_ptr()) as jlong
    }

    extern "system" fn native_destroy(_env: JNIEnv, _this: JObject, handle: jlong) {
        vault_shared_search_destroy(handle as *mut c_void);
    }

    extern "system" fn native_wait_for_scan(
        _env: JNIEnv,
        _this: JObject,
        handle: jlong,
        timeout_ms: jlong,
    ) -> jboolean {
        vault_shared_search_wait_for_scan(handle as *mut c_void, timeout_ms as u64) as jboolean
    }

    extern "system" fn native_progress_json(
        mut env: JNIEnv,
        _this: JObject,
        handle: jlong,
    ) -> jstring {
        unsafe {
            c_to_jstring(
                &mut env,
                vault_shared_search_progress_json(handle as *mut c_void),
            )
        }
    }

    extern "system" fn native_search_files_json(
        mut env: JNIEnv,
        _this: JObject,
        handle: jlong,
        query: JString,
        limit: jlong,
    ) -> jstring {
        let query = jstring_to_c(&mut env, query);
        unsafe {
            c_to_jstring(
                &mut env,
                vault_shared_search_files_json(handle as *mut c_void, query.as_ptr(), limit as u32),
            )
        }
    }

    extern "system" fn native_note_search_json(
        mut env: JNIEnv,
        _this: JObject,
        handle: jlong,
        query: JString,
        scope: JString,
    ) -> jstring {
        let query = jstring_to_c(&mut env, query);
        let scope = jstring_to_c(&mut env, scope);
        unsafe {
            c_to_jstring(
                &mut env,
                vault_shared_note_search_json(
                    handle as *mut c_void,
                    query.as_ptr(),
                    scope.as_ptr(),
                ),
            )
        }
    }

    extern "system" fn native_search_track_selection_json(
        mut env: JNIEnv,
        _this: JObject,
        handle: jlong,
        query: JString,
        note_path: JString,
    ) -> jstring {
        let query = jstring_to_c(&mut env, query);
        let note_path = jstring_to_c(&mut env, note_path);
        unsafe {
            c_to_jstring(
                &mut env,
                vault_shared_search_track_selection_json(
                    handle as *mut c_void,
                    query.as_ptr(),
                    note_path.as_ptr(),
                ),
            )
        }
    }

    extern "system" fn native_take_last_error(mut env: JNIEnv, _this: JObject) -> jstring {
        unsafe { c_to_jstring(&mut env, vault_shared_take_last_error()) }
    }
}
