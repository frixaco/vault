use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_void};
use std::path::PathBuf;
use std::ptr;
use std::time::Duration;

use fff_search::{
    FFFMode, FilePicker, FilePickerOptions, FrecencyTracker, FuzzySearchOptions, PaginationArgs,
    QueryParser, QueryTracker, SharedFrecency, SharedPicker, SharedQueryTracker,
};
use serde::Serialize;

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
                FrecencyTracker::new(data_path_buf.join("fff-frecency"), false)
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
        query_tracker
            .init(
                QueryTracker::new(data_path_buf.join("fff-history"), false)
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
        let guard = self.picker.read().map_err(|error| error.to_string())?;
        let picker = guard.as_ref().ok_or("fff picker is not initialized")?;
        let query_tracker_guard = self
            .query_tracker
            .read()
            .map_err(|error| error.to_string())?;
        let parser = QueryParser::default();
        let parsed = parser.parse(&query);
        let results = picker.fuzzy_search(
            &parsed,
            query_tracker_guard.as_ref(),
            FuzzySearchOptions {
                max_threads: 0,
                current_file: None,
                project_path: Some(&self.base_path),
                pagination: PaginationArgs {
                    offset: 0,
                    limit: limit.clamp(1, 200),
                },
                ..Default::default()
            },
        );

        let items = results
            .items
            .iter()
            .zip(results.scores.iter())
            .map(|(item, score)| {
                let path = item.relative_path(picker);
                let name = item.file_name(picker);
                let directory = item.dir_str(picker);

                SearchItem {
                    path,
                    name,
                    directory,
                    score: score.total,
                }
            })
            .collect();

        Ok(SearchResponse {
            items,
            total_files: results.total_files,
            total_matched: results.total_matched,
        })
    }
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

    string_to_c(serde_json::to_string(&envelope).unwrap_or_else(|error| {
        format!(r#"{{"ok":false,"value":null,"error":"{error}"}}"#)
    }))
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
pub extern "C" fn vault_search_create(
    base_path: *const c_char,
    data_path: *const c_char,
) -> *mut c_void {
    let result = c_string_to_string(base_path)
        .and_then(|base_path| Ok((base_path, c_string_to_string(data_path)?)))
        .and_then(|(base_path, data_path)| VaultSearch::new(base_path, data_path));

    match result {
        Ok(search) => Box::into_raw(Box::new(search)) as *mut c_void,
        Err(error) => {
            vault_search_set_last_error(error);
            ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "C" fn vault_search_destroy(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }

    unsafe {
        drop(Box::from_raw(handle as *mut VaultSearch));
    }
}

#[no_mangle]
pub extern "C" fn vault_search_wait_for_scan(handle: *mut c_void, timeout_ms: u64) -> bool {
    with_search(handle, |search| Ok(search.wait_for_scan(timeout_ms))).unwrap_or(false)
}

#[no_mangle]
pub extern "C" fn vault_search_progress_json(handle: *mut c_void) -> *mut c_char {
    json_result(with_search(handle, |search| search.progress()))
}

#[no_mangle]
pub extern "C" fn vault_search_files_json(
    handle: *mut c_void,
    query: *const c_char,
    limit: u32,
) -> *mut c_char {
    json_result(with_search(handle, |search| {
        search.search(c_string_to_string(query)?, limit as usize)
    }))
}

#[no_mangle]
pub extern "C" fn vault_search_free_string(value: *mut c_char) {
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

fn vault_search_set_last_error(error: String) {
    LAST_ERROR.with(|last_error| {
        *last_error.borrow_mut() = Some(error);
    });
}

#[no_mangle]
pub extern "C" fn vault_search_take_last_error() -> *mut c_char {
    LAST_ERROR.with(|last_error| {
        string_to_c(
            last_error
                .borrow_mut()
                .take()
                .unwrap_or_else(|| "unknown fff-search error".to_string()),
        )
    })
}

#[cfg(target_os = "android")]
mod android {
    use std::ffi::CString;
    use std::os::raw::c_void;

    use jni::objects::{JObject, JString};
    use jni::sys::{jboolean, jlong, jstring};
    use jni::JNIEnv;

    use super::{
        c_string_to_string, string_to_c, vault_search_create, vault_search_destroy,
        vault_search_files_json, vault_search_free_string, vault_search_progress_json,
        vault_search_take_last_error, vault_search_wait_for_scan,
    };

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
        vault_search_free_string(value);
        env.new_string(string).expect("valid Java string").into_raw()
    }

    #[no_mangle]
    pub extern "system" fn Java_expo_modules_vaultsearch_VaultSearchModule_nativeCreate(
        mut env: JNIEnv,
        _this: JObject,
        base_path: JString,
        data_path: JString,
    ) -> jlong {
        let base_path = jstring_to_c(&mut env, base_path);
        let data_path = jstring_to_c(&mut env, data_path);

        vault_search_create(base_path.as_ptr(), data_path.as_ptr()) as jlong
    }

    #[no_mangle]
    pub extern "system" fn Java_expo_modules_vaultsearch_VaultSearchModule_nativeDestroy(
        _env: JNIEnv,
        _this: JObject,
        handle: jlong,
    ) {
        vault_search_destroy(handle as *mut c_void);
    }

    #[no_mangle]
    pub extern "system" fn Java_expo_modules_vaultsearch_VaultSearchModule_nativeWaitForScan(
        _env: JNIEnv,
        _this: JObject,
        handle: jlong,
        timeout_ms: jlong,
    ) -> jboolean {
        vault_search_wait_for_scan(handle as *mut c_void, timeout_ms as u64) as jboolean
    }

    #[no_mangle]
    pub extern "system" fn Java_expo_modules_vaultsearch_VaultSearchModule_nativeProgressJson(
        mut env: JNIEnv,
        _this: JObject,
        handle: jlong,
    ) -> jstring {
        unsafe { c_to_jstring(&mut env, vault_search_progress_json(handle as *mut c_void)) }
    }

    #[no_mangle]
    pub extern "system" fn Java_expo_modules_vaultsearch_VaultSearchModule_nativeSearchFilesJson(
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
                vault_search_files_json(handle as *mut c_void, query.as_ptr(), limit as u32),
            )
        }
    }

    #[no_mangle]
    pub extern "system" fn Java_expo_modules_vaultsearch_VaultSearchModule_nativeTakeLastError(
        mut env: JNIEnv,
        _this: JObject,
    ) -> jstring {
        unsafe { c_to_jstring(&mut env, vault_search_take_last_error()) }
    }
}
