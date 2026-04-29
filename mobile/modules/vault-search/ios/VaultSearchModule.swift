import ExpoModulesCore

@_silgen_name("vault_search_create")
private func vaultSearchCreate(
  _ basePath: UnsafePointer<CChar>,
  _ dataPath: UnsafePointer<CChar>
) -> UnsafeMutableRawPointer?

@_silgen_name("vault_search_destroy")
private func vaultSearchDestroy(_ handle: UnsafeMutableRawPointer?)

@_silgen_name("vault_search_wait_for_scan")
private func vaultSearchWaitForScan(_ handle: UnsafeMutableRawPointer?, _ timeoutMs: UInt64) -> Bool

@_silgen_name("vault_search_progress_json")
private func vaultSearchProgressJson(_ handle: UnsafeMutableRawPointer?) -> UnsafeMutablePointer<CChar>?

@_silgen_name("vault_search_files_json")
private func vaultSearchFilesJson(
  _ handle: UnsafeMutableRawPointer?,
  _ query: UnsafePointer<CChar>,
  _ limit: UInt32
) -> UnsafeMutablePointer<CChar>?

@_silgen_name("vault_search_free_string")
private func vaultSearchFreeString(_ value: UnsafeMutablePointer<CChar>?)

@_silgen_name("vault_search_take_last_error")
private func vaultSearchTakeLastError() -> UnsafeMutablePointer<CChar>?

public class VaultSearchModule: Module {
  private var handle: UnsafeMutableRawPointer?

  deinit {
    destroyHandle()
  }

  public func definition() -> ModuleDefinition {
    Name("VaultSearch")

    AsyncFunction("initialize") { (basePath: String, dataPath: String) in
      self.destroyHandle()

      let nextHandle = basePath.withCString { basePathPointer in
        dataPath.withCString { dataPathPointer in
          vaultSearchCreate(basePathPointer, dataPathPointer)
        }
      }

      guard let nextHandle else {
        throw NSError(
          domain: "VaultSearch",
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

      return vaultSearchWaitForScan(handle, timeoutMs)
    }

    AsyncFunction("getProgressJson") {
      try self.takeJson(vaultSearchProgressJson(try self.requireHandle()))
    }

    AsyncFunction("searchFilesJson") { (query: String, limit: UInt32) in
      try query.withCString { queryPointer in
        try self.takeJson(vaultSearchFilesJson(try self.requireHandle(), queryPointer, limit))
      }
    }

    Function("dispose") {
      self.destroyHandle()
    }
  }

  private func requireHandle() throws -> UnsafeMutableRawPointer {
    guard let handle else {
      throw NSError(
        domain: "VaultSearch",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "VaultSearch is not initialized"]
      )
    }

    return handle
  }

  private func destroyHandle() {
    if let handle {
      vaultSearchDestroy(handle)
      self.handle = nil
    }
  }

  private func takeJson(_ pointer: UnsafeMutablePointer<CChar>?) throws -> String {
    guard let pointer else {
      throw NSError(
        domain: "VaultSearch",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "VaultSearch returned an empty response"]
      )
    }

    defer {
      vaultSearchFreeString(pointer)
    }

    return String(cString: pointer)
  }

  private func takeLastError() -> String {
    guard let pointer = vaultSearchTakeLastError() else {
      return "Unknown VaultSearch native error"
    }

    defer {
      vaultSearchFreeString(pointer)
    }

    return String(cString: pointer)
  }
}
