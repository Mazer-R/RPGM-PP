// The JavaScript engine host. Owns V8: one platform, one isolate, one
// context. It loads script files as classic global scripts, runs the frame
// callbacks the scripts register, and turns uncaught errors into log entries
// with the script name and line.
//
// It gives scripts their few native globals (console, performance.now,
// requestAnimationFrame) and the `player` object: files, the game list's
// functions, profiling, and the bindings installed by InstallBindings (gl,
// canvas, audio, video). Everything a browser has beyond that is made in
// JavaScript, in js/.
#pragma once

#include <atomic>
#include <csignal>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "v8-profiler.h"
#include "v8.h"

namespace mvp {

class Clock;
class AudioOutput;
class VideoPlayer;
class Log;

class Host {
 public:
  Host(Log& log, const Clock& clock);
  ~Host();
  Host(const Host&) = delete;
  Host& operator=(const Host&) = delete;

  // Tells the host where the game and the player's own files are. Scripts
  // see them as player.gameDir and player.playerDir, and file writes are
  // allowed only inside the game's save folder.
  void SetDirectories(const std::string& game_dir, const std::string& player_dir);

  // Loads and runs one script file. Returns false if it could not be read
  // or threw; the reason is written to the log.
  bool RunFile(const std::string& path);

  // Calls every callback registered with requestAnimationFrame since the
  // last call, passing `now_ms`. Callbacks registered while running are kept
  // for the next frame, as in a browser.
  // Starts a watchdog thread for scripts that stop returning. The main loop
  // calls Heartbeat() once per frame. When no heartbeat arrives for several
  // seconds, the JavaScript stack at that moment is written to the log (once
  // per stall). When `*stop_flag` becomes non-zero during a stall, the
  // running script is terminated so the player can exit.
  void StartWatchdog(const volatile std::sig_atomic_t* stop_flag);
  void Heartbeat();

  // Sets player.<name> to a list of strings.
  void SetStringList(const std::string& name, const std::vector<std::string>& values);
  // Sets player.<name> to true or false, for options scripts consult.
  void SetFlag(const std::string& name, bool value);
  // The file the game list keeps its remembered games in; none by default.
  void SetGamesFile(const std::string& path) { games_file_ = path; }
  void RunFrameCallbacks(double now_ms);
  // Tells the scripts that a key went down or up, by calling player.onKey
  // (keyCode, down) if a script has set it. `key_code` is a browser key code.
  void DispatchKey(int key_code, bool down);
  // Calls player.onPointer(phase, x, y), if the script set one: a finger or
  // the mouse put down (0), moved (1) or lifted (2), in screen pixels.
  void DispatchPointer(int phase, float x, float y);
  // Calls player.onResize(width, height), if the script set one: the
  // window's new size in pixels.
  void DispatchResize(int width, int height);

  // True while at least one frame callback is waiting. With none, and no
  // other source of work, no script code can ever run again.
  bool has_pending_frames() const { return !frame_callbacks_.empty(); }
  // Makes the native bindings available to scripts: `player.gl`, the WebGL
  // context for the current OpenGL ES context, and `player.canvas`, the
  // Canvas 2D and image functions. The JavaScript browser layer builds the
  // objects the game expects on top of these.
  // `audio` may be null: the scripts then see no player.audio. Likewise
  // `video` and player.video.
  void InstallBindings(int drawing_width, int drawing_height, AudioOutput* audio, VideoPlayer* video);
  bool exit_requested() const { return exit_requested_; }
  int exit_code() const { return exit_code_; }
  bool had_script_error() const { return had_script_error_; }
  const float* clear_color() const { return clear_color_; }
  std::string HeapSummary() const;

 private:
  static Host* FromArgs(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ConsoleInfoCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ConsoleWarnCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ConsoleErrorCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void NowCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void RequestFrameCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetClearColorCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ExitCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ReadTextFileCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void FileExistsCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void LoadScriptCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void WriteSaveFileCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void RemoveSaveFileCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void RenameSaveFileCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void MakeSaveDirCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ListDirCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ListFolderCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ResolveGameCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ChangeGamesFile(const v8::FunctionCallbackInfo<v8::Value>& args,
                              std::string (*change)(const std::string&, const std::string&));
  static void RememberGameCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ForgetGameCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void FileHeadCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ReadFileBytesCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void PrintCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void StartProfileCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void MemoryPausesCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void RunEngineTasksCallback(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void StopProfileCallback(const v8::FunctionCallbackInfo<v8::Value>& args);

  // True if `path` is inside the game's save folder and has no "..".
  bool IsSavePath(const std::string& path) const;

  void InstallGlobals(v8::Local<v8::Context> context);
  void ReportException(v8::TryCatch* try_catch);

  Log& log_;
  const Clock& clock_;
  v8::ArrayBuffer::Allocator* allocator_ = nullptr;
  v8::Isolate* isolate_ = nullptr;
  v8::Global<v8::Context> context_;
  std::vector<v8::Global<v8::Function>> frame_callbacks_;
  float clear_color_[3] = {0.0f, 0.0f, 0.0f};
  std::string game_dir_;
  std::string player_dir_;
  std::string games_file_;
  int script_depth_ = 0;  // > 0 while a script is running, for nested loads
  bool exit_requested_ = false;
  v8::CpuProfiler* profiler_ = nullptr;  // only while a profile is being taken
  std::thread watchdog_;
  std::atomic<bool> watchdog_stop_{false};
  std::atomic<double> last_heartbeat_ms_{0};
  std::atomic<bool> stall_reported_{false};
  static void LogStall(v8::Isolate* isolate, void* data);
  bool had_script_error_ = false;
  int exit_code_ = 0;
};

}  // namespace mvp
