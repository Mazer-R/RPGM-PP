#include "bindings/video_binding.h"

#include <string>

#include "platform/files.h"
#include "platform/video.h"

namespace mvp {
namespace {

using Args = v8::FunctionCallbackInfo<v8::Value>;

VideoPlayer* VideoOf(const Args& args) {
  return static_cast<VideoPlayer*>(args.Data().As<v8::External>()->Value());
}

double Number(const Args& args, int index, double fallback) {
  if (args.Length() <= index) return fallback;
  double value = args[index]->NumberValue(args.GetIsolate()->GetCurrentContext()).FromMaybe(fallback);
  return value == value ? value : fallback;  // NaN gives the fallback
}

void Open(const Args& args) {
  v8::String::Utf8Value utf8(args.GetIsolate(), args[0]);
  std::string written = *utf8 ? std::string(*utf8, static_cast<size_t>(utf8.length())) : std::string();
  // As for every game file, the name may differ from the file's in case.
  args.GetReturnValue().Set(VideoOf(args)->Open(FindFile(written), static_cast<int>(Number(args, 1, 0)),
                                                static_cast<int>(Number(args, 2, 0))));
}
void Play(const Args& args) { VideoOf(args)->Play(); }
void Pause(const Args& args) { VideoOf(args)->Pause(); }
void Close(const Args& args) { VideoOf(args)->Close(); }
void SetVolume(const Args& args) { VideoOf(args)->SetVolume(static_cast<float>(Number(args, 0, 1))); }
void Show(const Args& args) { VideoOf(args)->Show(args.Length() > 0 && args[0]->BooleanValue(args.GetIsolate())); }
void State(const Args& args) { args.GetReturnValue().Set(static_cast<int>(VideoOf(args)->state())); }

}  // namespace

void InstallVideoBinding(v8::Isolate* isolate, v8::Local<v8::Context> context,
                         v8::Local<v8::Object> player, VideoPlayer* video_player) {
  v8::Local<v8::Object> video = v8::Object::New(isolate);
  v8::Local<v8::External> data = v8::External::New(isolate, video_player);
  auto add = [&](const char* name, v8::FunctionCallback callback) {
    video->Set(context, v8::String::NewFromUtf8(isolate, name).ToLocalChecked(),
               v8::Function::New(context, callback, data).ToLocalChecked())
        .Check();
  };
  add("open", Open);
  add("play", Play);
  add("pause", Pause);
  add("close", Close);
  add("setVolume", SetVolume);
  add("show", Show);
  add("state", State);
  player->Set(context, v8::String::NewFromUtf8(isolate, "video").ToLocalChecked(), video).Check();
}

}  // namespace mvp
