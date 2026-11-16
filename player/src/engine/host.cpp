#include "engine/host.h"

#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <fstream>
#include <map>
#include <algorithm>
#include <chrono>
#include <sstream>
#include <utility>

#include "bindings/audio_binding.h"
#include "bindings/canvas_binding.h"
#include "bindings/webgl_binding.h"
#include "libplatform/libplatform.h"
#include "platform/clock.h"
#include "platform/files.h"
#include "platform/log.h"

namespace mvp {

namespace {

std::string ToStdString(v8::Isolate* isolate, v8::Local<v8::Value> value) {
  v8::String::Utf8Value utf8(isolate, value);
  return *utf8 ? std::string(*utf8, static_cast<size_t>(utf8.length())) : std::string();
}

v8::Local<v8::String> ToV8String(v8::Isolate* isolate, const std::string& text) {
  return v8::String::NewFromUtf8(isolate, text.c_str(), v8::NewStringType::kNormal,
                                 static_cast<int>(text.size()))
      .ToLocalChecked();
}

}  // namespace

Host::Host(Log& log, const Clock& clock) : log_(log), clock_(clock) {
  platform_ = v8::platform::NewDefaultPlatform();
  v8::V8::InitializePlatform(platform_.get());
  v8::V8::Initialize();

  v8::Isolate::CreateParams params;
  allocator_ = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
  params.array_buffer_allocator = allocator_;
  isolate_ = v8::Isolate::New(params);
  // Promise callbacks run only when the host says so: after each script and
  // after each callback, as a browser does.
  isolate_->SetMicrotasksPolicy(v8::MicrotasksPolicy::kExplicit);

  v8::Isolate::Scope isolate_scope(isolate_);
  v8::HandleScope handle_scope(isolate_);
  v8::Local<v8::Context> context = v8::Context::New(isolate_);
  context_.Reset(isolate_, context);
  v8::Context::Scope context_scope(context);
  InstallGlobals(context);
}

Host::~Host() {
  if (profiler_) profiler_->Dispose();
  watchdog_stop_ = true;
  if (watchdog_.joinable()) watchdog_.join();
  frame_callbacks_.clear();
  // Anything holding references into the engine lets go before it is disposed.
  ReleaseWebGLBinding();
  ReleaseCanvasBinding();
  context_.Reset();
  if (isolate_) isolate_->Dispose();
  v8::V8::Dispose();
  v8::V8::DisposePlatform();
  delete allocator_;
}

Host* Host::FromArgs(const v8::FunctionCallbackInfo<v8::Value>& args) {
  return static_cast<Host*>(args.Data().As<v8::External>()->Value());
}

namespace {
// Joins a console call's arguments into one line, as text.
std::string JoinArguments(const v8::FunctionCallbackInfo<v8::Value>& args) {
  std::string text;
  for (int i = 0; i < args.Length(); i++) {
    if (i > 0) text += ' ';
    text += ToStdString(args.GetIsolate(), args[i]);
  }
  return text;
}
}  // namespace

// One callback per level: this V8 version no longer tells a callback which
// function object it was called through.
void Host::ConsoleInfoCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  FromArgs(args)->log_.Write(LogLevel::kInfo, "game", JoinArguments(args));
}

void Host::ConsoleWarnCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  FromArgs(args)->log_.Write(LogLevel::kWarning, "game", JoinArguments(args));
}

void Host::ConsoleErrorCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  FromArgs(args)->log_.Write(LogLevel::kError, "game", JoinArguments(args));
}

void Host::NowCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(FromArgs(args)->clock_.NowMs());
}

void Host::RequestFrameCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Host* host = FromArgs(args);
  if (args.Length() < 1 || !args[0]->IsFunction()) return;
  host->frame_callbacks_.emplace_back(args.GetIsolate(), args[0].As<v8::Function>());
  args.GetReturnValue().Set(static_cast<int>(host->frame_callbacks_.size()));
}

void Host::SetClearColorCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Host* host = FromArgs(args);
  v8::Local<v8::Context> context = args.GetIsolate()->GetCurrentContext();
  for (int i = 0; i < 3 && i < args.Length(); i++) {
    host->clear_color_[i] = static_cast<float>(args[i]->NumberValue(context).FromMaybe(0.0));
  }
}

void Host::ExitCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Host* host = FromArgs(args);
  v8::Local<v8::Context> context = args.GetIsolate()->GetCurrentContext();
  host->exit_requested_ = true;
  host->exit_code_ = args.Length() > 0 ? args[0]->Int32Value(context).FromMaybe(0) : 0;
}

bool Host::IsSavePath(const std::string& path) const {
  if (game_dir_.empty() || path.find("..") != std::string::npos) return false;
  const std::string root = game_dir_ + "/save";
  return path == root || path.compare(0, root.size() + 1, root + "/") == 0;
}

void Host::ReadTextFileCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  v8::Isolate* isolate = args.GetIsolate();
  std::ifstream file(FindFile(ToStdString(isolate, args[0])), std::ios::binary);
  if (!file) {
    args.GetReturnValue().SetNull();
    return;
  }
  std::stringstream buffer;
  buffer << file.rdbuf();
  args.GetReturnValue().Set(ToV8String(isolate, buffer.str()));
}

void Host::FileExistsCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  struct stat info {};
  args.GetReturnValue().Set(stat(FindFile(ToStdString(args.GetIsolate(), args[0])).c_str(), &info) == 0);
}

// player.readFileBytes(path, maxBytes): the file's bytes as an ArrayBuffer,
// or its first maxBytes when that is given and smaller; null if it cannot
// be read.
void Host::ReadFileBytesCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  v8::Isolate* isolate = args.GetIsolate();
  std::ifstream file(FindFile(ToStdString(isolate, args[0])), std::ios::binary | std::ios::ate);
  if (!file) {
    args.GetReturnValue().SetNull();
    return;
  }
  std::streamoff size = file.tellg();
  double limit = args.Length() > 1 ? args[1]->NumberValue(isolate->GetCurrentContext()).FromMaybe(0) : 0;
  if (limit >= 1 && limit < static_cast<double>(size)) size = static_cast<std::streamoff>(limit);
  v8::Local<v8::ArrayBuffer> buffer = v8::ArrayBuffer::New(isolate, static_cast<size_t>(size));
  file.seekg(0);
  file.read(static_cast<char*>(buffer->Data()), size);
  args.GetReturnValue().Set(buffer);
}

// player.listDir(path): the names in a folder, sorted, without "." and "..";
// an empty list if the folder cannot be read.
void Host::ListDirCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  v8::Isolate* isolate = args.GetIsolate();
  v8::Local<v8::Context> context = isolate->GetCurrentContext();
  std::vector<std::string> names;
  if (DIR* dir = opendir(ToStdString(isolate, args[0]).c_str())) {
    while (dirent* entry = readdir(dir)) {
      std::string name = entry->d_name;
      if (name != "." && name != "..") names.push_back(name);
    }
    closedir(dir);
  }
  std::sort(names.begin(), names.end());
  v8::Local<v8::Array> list = v8::Array::New(isolate, static_cast<int>(names.size()));
  for (uint32_t i = 0; i < names.size(); i++) list->Set(context, i, ToV8String(isolate, names[i])).Check();
  args.GetReturnValue().Set(list);
}

// player.print(text): one line on standard output, for a script whose
// result is read by the program that started the player.
void Host::PrintCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  std::string text = ToStdString(args.GetIsolate(), args[0]);
  std::fprintf(stdout, "%s\n", text.c_str());
  std::fflush(stdout);
}

// player.startProfile(): starts sampling where the scripts spend their time.
void Host::StartProfileCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Host* host = FromArgs(args);
  if (host->profiler_) return;
  host->profiler_ = v8::CpuProfiler::New(args.GetIsolate());
  host->profiler_->SetSamplingInterval(1000);  // microseconds
  host->profiler_->StartProfiling(ToV8String(args.GetIsolate(), "profile"), true);
}

// player.stopProfile(count): ends the sampling and returns the `count`
// functions with the most time spent in their own code (not in what they
// call), as lines of text: share of all samples, function, file and line.
void Host::StopProfileCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Host* host = FromArgs(args);
  v8::Isolate* isolate = args.GetIsolate();
  v8::Local<v8::Context> context = isolate->GetCurrentContext();
  if (!host->profiler_) return;
  v8::CpuProfile* profile = host->profiler_->StopProfiling(ToV8String(isolate, "profile"));
  std::map<std::string, unsigned> self_hits;
  unsigned total = 0;
  if (profile) {
    std::vector<const v8::CpuProfileNode*> pending = {profile->GetTopDownRoot()};
    while (!pending.empty()) {
      const v8::CpuProfileNode* node = pending.back();
      pending.pop_back();
      unsigned hits = node->GetHitCount();
      if (hits) {
        std::string file = node->GetScriptResourceNameStr();
        size_t slash = file.rfind('/');
        if (slash != std::string::npos) file = file.substr(slash + 1);
        std::string name = node->GetFunctionNameStr();
        if (name.empty()) name = "(anonymous)";
        std::string key = name + "  " + file + ":" + std::to_string(node->GetLineNumber());
        // A native function (no script file) is listed once per script
        // function that called it, so its cost can be traced to the caller.
        const v8::CpuProfileNode* parent = node->GetParent();
        if (file.empty() && parent) {
          std::string parent_file = parent->GetScriptResourceNameStr();
          size_t parent_slash = parent_file.rfind('/');
          if (parent_slash != std::string::npos) parent_file = parent_file.substr(parent_slash + 1);
          key = name + "  <- " + parent->GetFunctionNameStr() + "  " + parent_file + ":" +
                std::to_string(parent->GetLineNumber());
        }
        self_hits[key] += hits;
        total += hits;
      }
      for (int i = 0; i < node->GetChildrenCount(); i++) pending.push_back(node->GetChild(i));
    }
    profile->Delete();
  }
  host->profiler_->Dispose();
  host->profiler_ = nullptr;

  std::vector<std::pair<unsigned, std::string>> ranked;
  for (const auto& entry : self_hits) ranked.push_back({entry.second, entry.first});
  std::sort(ranked.begin(), ranked.end(), [](const auto& a, const auto& b) { return a.first > b.first; });
  size_t count = args.Length() > 0 ? static_cast<size_t>(args[0]->Int32Value(context).FromMaybe(30)) : 30;
  if (count > ranked.size()) count = ranked.size();
  v8::Local<v8::Array> lines = v8::Array::New(isolate, static_cast<int>(count));
  for (uint32_t i = 0; i < count; i++) {
    char share[16];
    std::snprintf(share, sizeof share, "%5.1f%%  ", total ? 100.0 * ranked[i].first / total : 0.0);
    lines->Set(context, i, ToV8String(isolate, share + ranked[i].second)).Check();
  }
  args.GetReturnValue().Set(lines);
}

void Host::LoadScriptCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Host* host = FromArgs(args);
  // A script that fails here is logged and reported to the caller, which
  // decides what it means. It is not fatal by itself: a browser carries on
  // when one script of a page fails, and games ship plugins that do.
  bool had_error = host->had_script_error_;
  bool ok = host->RunFile(ToStdString(args.GetIsolate(), args[0]));
  host->had_script_error_ = had_error;
  args.GetReturnValue().Set(ok);
}

// Writes a file inside the game's save folder so that a power cut cannot
// destroy an existing save: the new content goes to a temporary file that is
// flushed to the card, the previous version is kept as a backup, and only
// then does the temporary file take the real name.
void Host::WriteSaveFileCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  ForgetFileNames();  // the folder is about to change
  Host* host = FromArgs(args);
  v8::Isolate* isolate = args.GetIsolate();
  std::string path = ToStdString(isolate, args[0]);
  args.GetReturnValue().Set(false);
  if (!host->IsSavePath(path)) {
    host->log_.Write(LogLevel::kError, "files", "refused to write outside the save folder: " + path);
    return;
  }
  std::string text = ToStdString(isolate, args[1]);
  std::string temporary = path + ".tmp";
  std::FILE* file = std::fopen(temporary.c_str(), "wb");
  if (!file) {
    host->log_.Write(LogLevel::kError, "files", "cannot write " + temporary);
    return;
  }
  bool ok = std::fwrite(text.data(), 1, text.size(), file) == text.size();
  ok = std::fflush(file) == 0 && ok;
  ok = fsync(fileno(file)) == 0 && ok;
  ok = std::fclose(file) == 0 && ok;
  if (!ok) {
    host->log_.Write(LogLevel::kError, "files", "write failed: " + temporary);
    std::remove(temporary.c_str());
    return;
  }
  std::rename(path.c_str(), (path + ".bak").c_str());  // fails harmlessly on a first save
  if (std::rename(temporary.c_str(), path.c_str()) != 0) {
    host->log_.Write(LogLevel::kError, "files", "cannot replace " + path);
    return;
  }
  args.GetReturnValue().Set(true);
}

void Host::RemoveSaveFileCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  ForgetFileNames();  // the folder is about to change
  Host* host = FromArgs(args);
  std::string path = ToStdString(args.GetIsolate(), args[0]);
  args.GetReturnValue().Set(host->IsSavePath(path) && std::remove(path.c_str()) == 0);
}

void Host::MakeSaveDirCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  ForgetFileNames();  // the folder is about to change
  Host* host = FromArgs(args);
  std::string path = ToStdString(args.GetIsolate(), args[0]);
  args.GetReturnValue().Set(host->IsSavePath(path) && mkdir(path.c_str(), 0755) == 0);
}

void Host::SetDirectories(const std::string& game_dir, const std::string& player_dir) {
  game_dir_ = game_dir;
  player_dir_ = player_dir;
  v8::Isolate::Scope isolate_scope(isolate_);
  v8::HandleScope handle_scope(isolate_);
  v8::Local<v8::Context> context = context_.Get(isolate_);
  v8::Context::Scope context_scope(context);
  v8::Local<v8::Value> player;
  if (!context->Global()->Get(context, ToV8String(isolate_, "player")).ToLocal(&player) ||
      !player->IsObject()) {
    return;
  }
  v8::Local<v8::Object> object = player.As<v8::Object>();
  object->Set(context, ToV8String(isolate_, "gameDir"), ToV8String(isolate_, game_dir)).Check();
  object->Set(context, ToV8String(isolate_, "playerDir"), ToV8String(isolate_, player_dir)).Check();
}

void Host::InstallGlobals(v8::Local<v8::Context> context) {
  v8::Local<v8::External> self = v8::External::New(isolate_, this);
  v8::Local<v8::Object> global = context->Global();
  auto make_function = [&](v8::FunctionCallback callback, const char* name) {
    v8::Local<v8::Function> function =
        v8::Function::New(context, callback, self).ToLocalChecked();
    function->SetName(ToV8String(isolate_, name));
    return function;
  };
  auto set = [&](v8::Local<v8::Object> target, const char* name, v8::Local<v8::Value> value) {
    target->Set(context, ToV8String(isolate_, name), value).Check();
  };

  v8::Local<v8::Object> console = v8::Object::New(isolate_);
  set(console, "log", make_function(ConsoleInfoCallback, "log"));
  set(console, "info", make_function(ConsoleInfoCallback, "info"));
  set(console, "warn", make_function(ConsoleWarnCallback, "warn"));
  set(console, "error", make_function(ConsoleErrorCallback, "error"));
  set(global, "console", console);

  v8::Local<v8::Object> performance = v8::Object::New(isolate_);
  set(performance, "now", make_function(NowCallback, "now"));
  set(global, "performance", performance);

  set(global, "requestAnimationFrame", make_function(RequestFrameCallback, "requestAnimationFrame"));

  v8::Local<v8::Object> player = v8::Object::New(isolate_);
  set(player, "setClearColor", make_function(SetClearColorCallback, "setClearColor"));
  set(player, "exit", make_function(ExitCallback, "exit"));
  set(player, "readTextFile", make_function(ReadTextFileCallback, "readTextFile"));
  set(player, "fileExists", make_function(FileExistsCallback, "fileExists"));
  set(player, "loadScript", make_function(LoadScriptCallback, "loadScript"));
  set(player, "writeSaveFile", make_function(WriteSaveFileCallback, "writeSaveFile"));
  set(player, "removeSaveFile", make_function(RemoveSaveFileCallback, "removeSaveFile"));
  set(player, "makeSaveDir", make_function(MakeSaveDirCallback, "makeSaveDir"));
  set(player, "listDir", make_function(ListDirCallback, "listDir"));
  set(player, "print", make_function(PrintCallback, "print"));
  set(player, "readFileBytes", make_function(ReadFileBytesCallback, "readFileBytes"));
  set(player, "startProfile", make_function(StartProfileCallback, "startProfile"));
  set(player, "stopProfile", make_function(StopProfileCallback, "stopProfile"));
  set(player, "v8Version", ToV8String(isolate_, v8::V8::GetVersion()));
  set(global, "player", player);
}

void Host::InstallBindings(int drawing_width, int drawing_height, AudioOutput* audio) {
  v8::Isolate::Scope isolate_scope(isolate_);
  v8::HandleScope handle_scope(isolate_);
  v8::Local<v8::Context> context = context_.Get(isolate_);
  v8::Context::Scope context_scope(context);
  v8::Local<v8::Value> player;
  if (!context->Global()->Get(context, ToV8String(isolate_, "player")).ToLocal(&player) ||
      !player->IsObject()) {
    return;
  }
  player.As<v8::Object>()
      ->Set(context, ToV8String(isolate_, "gl"),
            CreateWebGLContext(isolate_, context, drawing_width, drawing_height))
      .Check();
  InstallCanvasBinding(isolate_, context, player.As<v8::Object>());
  if (audio) InstallAudioBinding(isolate_, context, player.As<v8::Object>(), audio);
}

void Host::ReportException(v8::TryCatch* try_catch) {
  had_script_error_ = true;
  v8::HandleScope handle_scope(isolate_);
  v8::Local<v8::Context> context = context_.Get(isolate_);
  std::string text = ToStdString(isolate_, try_catch->Exception());
  v8::Local<v8::Message> message = try_catch->Message();
  if (!message.IsEmpty()) {
    std::string file = ToStdString(isolate_, message->GetScriptOrigin().ResourceName());
    int line = message->GetLineNumber(context).FromMaybe(0);
    text = file + ":" + std::to_string(line) + ": " + text;
  }
  v8::Local<v8::Value> stack;
  if (try_catch->StackTrace(context).ToLocal(&stack) && stack->IsString()) {
    text += "\n" + ToStdString(isolate_, stack);
  }
  log_.Write(LogLevel::kError, "script", text);
}

bool Host::RunFile(const std::string& written_path) {
  // Scripts are compiled under the name the file really has.
  std::string path = FindFile(written_path);
  std::ifstream file(path, std::ios::binary);
  if (!file) {
    log_.Write(LogLevel::kError, "host", "cannot read script: " + path);
    had_script_error_ = true;
    return false;
  }
  std::stringstream buffer;
  buffer << file.rdbuf();

  v8::Isolate::Scope isolate_scope(isolate_);
  v8::HandleScope handle_scope(isolate_);
  v8::Local<v8::Context> context = context_.Get(isolate_);
  v8::Context::Scope context_scope(context);
  v8::TryCatch try_catch(isolate_);

  // Compiled with its real file name, so errors and stacks point at it.
  v8::ScriptOrigin origin(isolate_, ToV8String(isolate_, path));
  v8::Local<v8::Script> script;
  v8::Local<v8::Value> result;
  script_depth_++;
  bool ok = v8::Script::Compile(context, ToV8String(isolate_, buffer.str()), &origin)
                .ToLocal(&script) &&
            script->Run(context).ToLocal(&result);
  script_depth_--;
  if (!ok) ReportException(&try_catch);
  // Promise callbacks run once the outermost script has finished, not in the
  // middle of a script that loaded this one.
  if (script_depth_ == 0) isolate_->PerformMicrotaskCheckpoint();
  return ok;
}

void Host::RunFrameCallbacks(double now_ms) {
  if (frame_callbacks_.empty()) return;
  v8::Isolate::Scope isolate_scope(isolate_);
  v8::HandleScope handle_scope(isolate_);
  v8::Local<v8::Context> context = context_.Get(isolate_);
  v8::Context::Scope context_scope(context);

  // Take the current list; callbacks that register again go to the next frame.
  std::vector<v8::Global<v8::Function>> callbacks = std::move(frame_callbacks_);
  frame_callbacks_.clear();
  v8::Local<v8::Value> argument = v8::Number::New(isolate_, now_ms);
  for (auto& callback : callbacks) {
    v8::TryCatch try_catch(isolate_);
    v8::Local<v8::Value> result;
    if (!callback.Get(isolate_)->Call(context, context->Global(), 1, &argument).ToLocal(&result)) {
      ReportException(&try_catch);
    }
    isolate_->PerformMicrotaskCheckpoint();
  }
}

void Host::Heartbeat() {
  last_heartbeat_ms_ = clock_.NowMs();
  stall_reported_ = false;
}

// Runs on the script thread, interrupting whatever script is running.
void Host::LogStall(v8::Isolate* isolate, void* data) {
  Host* host = static_cast<Host*>(data);
  v8::HandleScope handle_scope(isolate);
  std::string text = "a frame has not finished for several seconds; the script is at:";
  v8::Local<v8::StackTrace> trace = v8::StackTrace::CurrentStackTrace(isolate, 24);
  for (int i = 0; i < trace->GetFrameCount(); i++) {
    v8::Local<v8::StackFrame> frame = trace->GetFrame(isolate, static_cast<uint32_t>(i));
    text += "\n    at " + ToStdString(isolate, frame->GetFunctionName()) + " (" +
            ToStdString(isolate, frame->GetScriptName()) + ":" + std::to_string(frame->GetLineNumber()) + ")";
  }
  host->log_.Write(LogLevel::kError, "watchdog", text);
}

void Host::StartWatchdog(const volatile std::sig_atomic_t* stop_flag) {
  const double kStallMs = 5000;
  Heartbeat();
  watchdog_ = std::thread([this, stop_flag, kStallMs] {
    bool terminated = false;
    while (!watchdog_stop_) {
      std::this_thread::sleep_for(std::chrono::milliseconds(250));
      double silent_ms = clock_.NowMs() - last_heartbeat_ms_;
      if (silent_ms > kStallMs && !stall_reported_.exchange(true)) {
        // Written here as well: if the stall is inside native code, the
        // interrupt below is not served until that code returns.
        std::fprintf(stderr, "watchdog: no frame finished for %.0f s\n", silent_ms / 1000.0);
        isolate_->RequestInterrupt(&Host::LogStall, this);
      }
      // Asked to stop while a script is not returning: end that script.
      if (*stop_flag && silent_ms > 1000 && !terminated) {
        terminated = true;
        isolate_->TerminateExecution();
      }
    }
  });
}

void Host::SetStringList(const std::string& name, const std::vector<std::string>& values) {
  v8::Isolate::Scope isolate_scope(isolate_);
  v8::HandleScope handle_scope(isolate_);
  v8::Local<v8::Context> context = context_.Get(isolate_);
  v8::Context::Scope context_scope(context);
  v8::Local<v8::Value> player;
  if (!context->Global()->Get(context, ToV8String(isolate_, "player")).ToLocal(&player) || !player->IsObject()) return;
  v8::Local<v8::Array> list = v8::Array::New(isolate_, static_cast<int>(values.size()));
  for (uint32_t i = 0; i < values.size(); i++) list->Set(context, i, ToV8String(isolate_, values[i])).Check();
  player.As<v8::Object>()->Set(context, ToV8String(isolate_, name), list).Check();
}

void Host::SetFlag(const std::string& name, bool value) {
  v8::Isolate::Scope isolate_scope(isolate_);
  v8::HandleScope handle_scope(isolate_);
  v8::Local<v8::Context> context = context_.Get(isolate_);
  v8::Context::Scope context_scope(context);
  v8::Local<v8::Value> player;
  if (!context->Global()->Get(context, ToV8String(isolate_, "player")).ToLocal(&player) || !player->IsObject()) return;
  player.As<v8::Object>()->Set(context, ToV8String(isolate_, name), v8::Boolean::New(isolate_, value)).Check();
}

void Host::DispatchKey(int key_code, bool down) {
  v8::Isolate::Scope isolate_scope(isolate_);
  v8::HandleScope handle_scope(isolate_);
  v8::Local<v8::Context> context = context_.Get(isolate_);
  v8::Context::Scope context_scope(context);
  v8::TryCatch try_catch(isolate_);
  v8::Local<v8::Value> player, handler;
  if (!context->Global()->Get(context, ToV8String(isolate_, "player")).ToLocal(&player) ||
      !player->IsObject() ||
      !player.As<v8::Object>()->Get(context, ToV8String(isolate_, "onKey")).ToLocal(&handler) ||
      !handler->IsFunction()) {
    return;
  }
  v8::Local<v8::Value> arguments[2] = {v8::Integer::New(isolate_, key_code),
                                       v8::Boolean::New(isolate_, down)};
  v8::Local<v8::Value> result;
  if (!handler.As<v8::Function>()->Call(context, player, 2, arguments).ToLocal(&result)) {
    ReportException(&try_catch);
  }
  isolate_->PerformMicrotaskCheckpoint();
}

std::string Host::HeapSummary() const {
  v8::HeapStatistics stats;
  isolate_->GetHeapStatistics(&stats);
  return "JavaScript heap " + std::to_string(stats.used_heap_size() / 1024) + " KB used of " +
         std::to_string(stats.total_heap_size() / 1024) + " KB";
}

}  // namespace mvp
