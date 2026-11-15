// The JavaScript engine host. Owns V8: one platform, one isolate, one
// context. It loads script files as classic global scripts, runs the frame
// callbacks the scripts register, and turns uncaught errors into log entries
// with the script name and line.
//
// For now it also provides the few global functions the first stage needs
// (console, performance.now, requestAnimationFrame and a small `player`
// object). Later stages move those into the bindings and the JavaScript
// browser layer.
#pragma once

#include <memory>
#include <string>
#include <vector>

#include "v8.h"

namespace mvp {

class Clock;
class Log;

class Host {
 public:
  Host(Log& log, const Clock& clock);
  ~Host();
  Host(const Host&) = delete;
  Host& operator=(const Host&) = delete;

  // Loads and runs one script file. Returns false if it could not be read
  // or threw; the reason is written to the log.
  bool RunFile(const std::string& path);

  // Calls every callback registered with requestAnimationFrame since the
  // last call, passing `now_ms`. Callbacks registered while running are kept
  // for the next frame, as in a browser.
  void RunFrameCallbacks(double now_ms);

  // True while at least one frame callback is waiting. With none, and no
  // other source of work, no script code can ever run again.
  bool has_pending_frames() const { return !frame_callbacks_.empty(); }
  // Makes the native bindings available to scripts: `player.gl`, the WebGL
  // context for the current OpenGL ES context, and `player.canvas`, the
  // Canvas 2D and image functions. The JavaScript browser layer builds the
  // objects the game expects on top of these.
  void InstallBindings(int drawing_width, int drawing_height);
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

  void InstallGlobals(v8::Local<v8::Context> context);
  void ReportException(v8::TryCatch* try_catch);

  Log& log_;
  const Clock& clock_;
  std::unique_ptr<v8::Platform> platform_;
  v8::ArrayBuffer::Allocator* allocator_ = nullptr;
  v8::Isolate* isolate_ = nullptr;
  v8::Global<v8::Context> context_;
  std::vector<v8::Global<v8::Function>> frame_callbacks_;
  float clear_color_[3] = {0.0f, 0.0f, 0.0f};
  bool exit_requested_ = false;
  bool had_script_error_ = false;
  int exit_code_ = 0;
};

}  // namespace mvp
