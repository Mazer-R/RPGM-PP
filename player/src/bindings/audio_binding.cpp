#include "bindings/audio_binding.h"

#include <string>

#include "platform/audio.h"

namespace mvp {
namespace {

using Args = v8::FunctionCallbackInfo<v8::Value>;

AudioOutput* OutputOf(const Args& args) {
  return static_cast<AudioOutput*>(args.Data().As<v8::External>()->Value());
}

double Number(const Args& args, int index, double fallback) {
  if (args.Length() <= index) return fallback;
  double value = args[index]->NumberValue(args.GetIsolate()->GetCurrentContext()).FromMaybe(fallback);
  return value == value ? value : fallback;  // NaN gives the fallback
}

int Voice(const Args& args) { return static_cast<int>(Number(args, 0, 0)); }

std::string Path(const Args& args) {
  v8::String::Utf8Value utf8(args.GetIsolate(), args[0]);
  return *utf8 ? std::string(*utf8, static_cast<size_t>(utf8.length())) : std::string();
}

void Info(const Args& args) {
  v8::Isolate* isolate = args.GetIsolate();
  v8::Local<v8::Context> context = isolate->GetCurrentContext();
  SoundInfo info;
  if (!OutputOf(args)->Info(Path(args), &info)) {
    args.GetReturnValue().SetNull();
    return;
  }
  v8::Local<v8::Array> result = v8::Array::New(isolate, 3);
  result->Set(context, 0, v8::Number::New(isolate, info.seconds)).Check();
  result->Set(context, 1, v8::Integer::New(isolate, info.sample_rate)).Check();
  result->Set(context, 2, v8::Integer::New(isolate, info.channels)).Check();
  args.GetReturnValue().Set(result);
}

void Play(const Args& args) {
  PlayOptions options;
  options.volume = static_cast<float>(Number(args, 1, 1));
  options.pitch = static_cast<float>(Number(args, 2, 1));
  options.pan = static_cast<float>(Number(args, 3, 0));
  options.loop = args.Length() > 4 && args[4]->BooleanValue(args.GetIsolate());
  options.loop_start = Number(args, 5, 0);
  options.loop_end = Number(args, 6, 0);
  options.offset = Number(args, 7, 0);
  args.GetReturnValue().Set(OutputOf(args)->Play(Path(args), options));
}

void Stop(const Args& args) { OutputOf(args)->Stop(Voice(args)); }
void SetVolume(const Args& args) {
  OutputOf(args)->SetVolume(Voice(args), static_cast<float>(Number(args, 1, 1)), Number(args, 2, 0));
}
void SetPan(const Args& args) { OutputOf(args)->SetPan(Voice(args), static_cast<float>(Number(args, 1, 0))); }
void IsPlaying(const Args& args) { args.GetReturnValue().Set(OutputOf(args)->IsPlaying(Voice(args))); }
void TakePeak(const Args& args) { args.GetReturnValue().Set(static_cast<double>(OutputOf(args)->TakePeak())); }

}  // namespace

void InstallAudioBinding(v8::Isolate* isolate, v8::Local<v8::Context> context,
                         v8::Local<v8::Object> player, AudioOutput* output) {
  v8::Local<v8::Object> audio = v8::Object::New(isolate);
  v8::Local<v8::External> data = v8::External::New(isolate, output);
  auto add = [&](const char* name, v8::FunctionCallback callback) {
    audio->Set(context, v8::String::NewFromUtf8(isolate, name).ToLocalChecked(),
               v8::Function::New(context, callback, data).ToLocalChecked())
        .Check();
  };
  add("info", Info);
  add("play", Play);
  add("stop", Stop);
  add("setVolume", SetVolume);
  add("setPan", SetPan);
  add("isPlaying", IsPlaying);
  add("takePeak", TakePeak);
  player->Set(context, v8::String::NewFromUtf8(isolate, "audio").ToLocalChecked(), audio).Check();
}

}  // namespace mvp
