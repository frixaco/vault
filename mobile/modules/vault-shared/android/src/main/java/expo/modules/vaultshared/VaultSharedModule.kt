package expo.modules.vaultshared

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VaultSharedModule : Module() {
  private var handle: Long = 0

  override fun definition() = ModuleDefinition {
    Name("VaultShared")

    AsyncFunction("initialize") { basePath: String, dataPath: String ->
      destroyHandle()

      val nextHandle = nativeCreate(basePath, dataPath)
      if (nextHandle == 0L) {
        throw RuntimeException(nativeTakeLastError())
      }

      handle = nextHandle
    }

    AsyncFunction("waitForScan") { timeoutMs: Long ->
      if (handle == 0L) false else nativeWaitForScan(handle, timeoutMs)
    }

    AsyncFunction("getProgressJson") {
      nativeProgressJson(requireHandle())
    }

    AsyncFunction("searchFilesJson") { query: String, limit: Long ->
      nativeSearchFilesJson(requireHandle(), query, limit)
    }

    AsyncFunction("noteSearchJson") { query: String, scope: String ->
      nativeNoteSearchJson(requireHandle(), query, scope)
    }

    AsyncFunction("searchTrackSelectionJson") { query: String, notePath: String ->
      nativeSearchTrackSelectionJson(requireHandle(), query, notePath)
    }

    Function("dispose") {
      destroyHandle()
    }
  }

  private fun requireHandle(): Long {
    if (handle == 0L) {
      throw RuntimeException("VaultShared is not initialized")
    }

    return handle
  }

  private fun destroyHandle() {
    if (handle != 0L) {
      nativeDestroy(handle)
      handle = 0
    }
  }

  private external fun nativeCreate(basePath: String, dataPath: String): Long
  private external fun nativeDestroy(handle: Long)
  private external fun nativeWaitForScan(handle: Long, timeoutMs: Long): Boolean
  private external fun nativeProgressJson(handle: Long): String
  private external fun nativeSearchFilesJson(handle: Long, query: String, limit: Long): String
  private external fun nativeNoteSearchJson(handle: Long, query: String, scope: String): String
  private external fun nativeSearchTrackSelectionJson(
    handle: Long,
    query: String,
    notePath: String,
  ): String
  private external fun nativeTakeLastError(): String

  companion object {
    init {
      System.loadLibrary("vault_shared_ffi")
    }
  }
}
