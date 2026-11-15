#include "engine/host.h"

#include <fstream>
#include <sstream>
#include <utility>

#include "bindings/webgl_binding.h"
#include "libplatform/libplatform.h"
#include "platform/clock.h"
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
  frame_callbacks_.clear();
  // Anything holding references into the engine lets go before it is disposed.
  ReleaseWebGLBinding();
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
  set(player, "v8Version", ToV8String(isolate_, v8::V8::GetVersion()));
  set(global, "player", player);
}

void Host::InstallWebGL(int drawing_width, int drawing_height) {
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

bool Host::RunFile(const std::string& path) {
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
  bool ok = v8::Script::Compile(context, ToV8String(isolate_, buffer.str()), &origin)
                .ToLocal(&script) &&
            script->Run(context).ToLocal(&result);
  if (!ok) ReportException(&try_catch);
  isolate_->PerformMicrotaskCheckpoint();
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

std::string Host::HeapSummary() const {
  v8::HeapStatistics stats;
  isolate_->GetHeapStatistics(&stats);
  return "JavaScript heap " + std::to_string(stats.used_heap_size() / 1024) + " KB used of " +
         std::to_string(stats.total_heap_size() / 1024) + " KB";
}

}  // namespace mvp
