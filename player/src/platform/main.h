// The player's entry point as a function, so that a platform without a
// command line (Android) can call it with arguments it makes up itself.
#ifndef MVP_PLATFORM_MAIN_H_
#define MVP_PLATFORM_MAIN_H_

namespace mvp {

// Runs the player once with the given command line (see main.cpp for the
// arguments) and returns its exit code. May be called again afterwards.
int PlayerMain(int argc, char** argv);

}  // namespace mvp

#endif  // MVP_PLATFORM_MAIN_H_
