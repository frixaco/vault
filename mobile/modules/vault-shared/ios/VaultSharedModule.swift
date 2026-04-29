import ExpoModulesCore

@_silgen_name("vault_shared_search_create")
private func vaultSharedSearchCreate(
  _ basePath: UnsafePointer<CChar>,
  _ dataPath: UnsafePointer<CChar>
) -> UnsafeMutableRawPointer?

@_silgen_name("vault_shared_search_destroy")
private func vaultSharedSearchDestroy(_ handle: UnsafeMutableRawPointer?)

@_silgen_name("vault_shared_search_wait_for_scan")
private func vaultSharedSearchWaitForScan(_ handle: UnsafeMutableRawPointer?, _ timeoutMs: UInt64) -> Bool

@_silgen_name("vault_shared_search_progress_json")
private func vaultSharedSearchProgressJson(_ handle: UnsafeMutableRawPointer?) -> UnsafeMutablePointer<CChar>?

@_silgen_name("vault_shared_search_files_json")
private func vaultSharedSearchFilesJson(
  _ handle: UnsafeMutableRawPointer?,
  _ query: UnsafePointer<CChar>,
  _ limit: UInt32
) -> UnsafeMutablePointer<CChar>?

@_silgen_name("vault_shared_note_search_json")
private func vaultSharedNoteSearchJson(
  _ handle: UnsafeMutableRawPointer?,
  _ query: UnsafePointer<CChar>,
  _ scope: UnsafePointer<CChar>
) -> UnsafeMutablePointer<CChar>?

@_silgen_name("vault_shared_search_track_selection_json")
private func vaultSharedSearchTrackSelectionJson(
  _ handle: UnsafeMutableRawPointer?,
  _ query: UnsafePointer<CChar>,
  _ notePath: UnsafePointer<CChar>
) -> UnsafeMutablePointer<CChar>?

@_silgen_name("vault_shared_free_string")
private func vaultSharedFreeString(_ value: UnsafeMutablePointer<CChar>?)

@_silgen_name("vault_shared_take_last_error")
private func vaultSharedTakeLastError() -> UnsafeMutablePointer<CChar>?

public class VaultSharedModule: Module {
  private var handle: UnsafeMutableRawPointer?

  deinit {
    destroyHandle()
  }

  public func definition() -> ModuleDefinition {
    Name("VaultShared")

    AsyncFunction("initialize") { (basePath: String, dataPath: String) in
      self.destroyHandle()

      let nextHandle = basePath.withCString { basePathPointer in
        dataPath.withCString { dataPathPointer in
          vaultSharedSearchCreate(basePathPointer, dataPathPointer)
        }
      }

      guard let nextHandle else {
        throw NSError(
          domain: "VaultShared",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: self.takeLastError()]
        )
      }

      self.handle = nextHandle
    }

    AsyncFunction("waitForScan") { (timeoutMs: UInt64) in
      guard let handle = self.handle else {
        return false
      }

      return vaultSharedSearchWaitForScan(handle, timeoutMs)
    }

    AsyncFunction("getProgressJson") {
      try self.takeJson(vaultSharedSearchProgressJson(try self.requireHandle()))
    }

    AsyncFunction("searchFilesJson") { (query: String, limit: UInt32) in
      try query.withCString { queryPointer in
        try self.takeJson(vaultSharedSearchFilesJson(try self.requireHandle(), queryPointer, limit))
      }
    }

    AsyncFunction("noteSearchJson") { (query: String, scope: String) in
      try query.withCString { queryPointer in
        try scope.withCString { scopePointer in
          try self.takeJson(
            vaultSharedNoteSearchJson(try self.requireHandle(), queryPointer, scopePointer)
          )
        }
      }
    }

    AsyncFunction("searchTrackSelectionJson") { (query: String, notePath: String) in
      try query.withCString { queryPointer in
        try notePath.withCString { notePathPointer in
          try self.takeJson(
            vaultSharedSearchTrackSelectionJson(try self.requireHandle(), queryPointer, notePathPointer)
          )
        }
      }
    }

    Function("dispose") {
      self.destroyHandle()
    }
  }

  private func requireHandle() throws -> UnsafeMutableRawPointer {
    guard let handle else {
      throw NSError(
        domain: "VaultShared",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "VaultShared is not initialized"]
      )
    }

    return handle
  }

  private func destroyHandle() {
    if let handle {
      vaultSharedSearchDestroy(handle)
      self.handle = nil
    }
  }

  private func takeJson(_ pointer: UnsafeMutablePointer<CChar>?) throws -> String {
    guard let pointer else {
      throw NSError(
        domain: "VaultShared",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "VaultShared returned an empty response"]
      )
    }

    defer {
      vaultSharedFreeString(pointer)
    }

    return String(cString: pointer)
  }

  private func takeLastError() -> String {
    guard let pointer = vaultSharedTakeLastError() else {
      return "Unknown VaultShared native error"
    }

    defer {
      vaultSharedFreeString(pointer)
    }

    return String(cString: pointer)
  }
}
