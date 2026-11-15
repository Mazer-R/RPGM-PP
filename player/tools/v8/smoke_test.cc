// Smoke test for the V8 library built by build.sh. It embeds V8 the way the
// player will: one platform, one isolate, one context. It runs a short
// script and prints the V8 version, the script's result and how long a
// numeric loop took, which shows whether the JIT is working.
//
// Not part of the player; it only checks that the library links and runs.
#include <cstdio>
#include <memory>

#include "libplatform/libplatform.h"
#include "v8.h"

int main() {
  std::unique_ptr<v8::Platform> platform = v8::platform::NewDefaultPlatform();
  v8::V8::InitializePlatform(platform.get());
  v8::V8::Initialize();

  v8::Isolate::CreateParams params;
  params.array_buffer_allocator = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
  v8::Isolate* isolate = v8::Isolate::New(params);
  int exit_code = 0;
  {
    v8::Isolate::Scope isolate_scope(isolate);
    v8::HandleScope handle_scope(isolate);
    v8::Local<v8::Context> context = v8::Context::New(isolate);
    v8::Context::Scope context_scope(context);

    const char* source_text =
        "var started = Date.now();"
        "var total = 0;"
        "for (var i = 0; i < 30000000; i++) { total += Math.sqrt(i) % 7; }"
        "'loop result ' + Math.round(total) + ' in ' + (Date.now() - started) + ' ms'";
    v8::Local<v8::String> source =
        v8::String::NewFromUtf8(isolate, source_text).ToLocalChecked();
    v8::TryCatch try_catch(isolate);
    v8::Local<v8::Script> script;
    v8::Local<v8::Value> result;
    if (!v8::Script::Compile(context, source).ToLocal(&script) ||
        !script->Run(context).ToLocal(&result)) {
      v8::String::Utf8Value error(isolate, try_catch.Exception());
      std::printf("script failed: %s\n", *error);
      exit_code = 1;
    } else {
      v8::String::Utf8Value text(isolate, result);
      std::printf("V8 %s\n%s\n", v8::V8::GetVersion(), *text);
    }
  }
  isolate->Dispose();
  v8::V8::Dispose();
  v8::V8::DisposePlatform();
  delete params.array_buffer_allocator;
  return exit_code;
}
