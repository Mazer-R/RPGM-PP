cmake_minimum_required(VERSION 3.20)
project(mvplayer C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# V8 built by tools/v8/build.sh: headers under include/, one static library
# under lib/. Its build options (no pointer compression, no sandbox) need no
# extra definitions here; if tools/v8/args.gn changes them, add the matching
# V8_* definitions to this target.
set(MVP_V8_DIR "${CMAKE_SOURCE_DIR}/third_party/v8" CACHE PATH "V8 headers and library")
if(NOT EXISTS "${MVP_V8_DIR}/lib/libv8_monolith.a")
  message(FATAL_ERROR "V8 not found in ${MVP_V8_DIR}. Run tools/v8/build.sh first.")
endif()

if(ANDROID)
  # Android ships OpenGL ES and zlib but neither SDL nor Cairo. SDL is built
  # here from its source (MVP_SDL_DIR) as libSDL2.so, which its Java side
  # loads by that name; Cairo, pixman, FreeType and libpng are the static
  # libraries made by tools/build/build-android-deps.sh (MVP_DEPS_DIR).
  set(MVP_SDL_DIR "" CACHE PATH "SDL2 source folder")
  set(MVP_DEPS_DIR "${CMAKE_SOURCE_DIR}/third_party/android-deps" CACHE PATH "Cairo and friends for Android")
  set(SDL_STATIC OFF CACHE BOOL "" FORCE)
  set(SDL_TEST OFF CACHE BOOL "" FORCE)
  add_subdirectory("${MVP_SDL_DIR}" sdl2 EXCLUDE_FROM_ALL)
  set(MVP_PLATFORM_LIBS
    SDL2::SDL2
    "${MVP_DEPS_DIR}/lib/libcairo.a" "${MVP_DEPS_DIR}/lib/libpixman-1.a"
    "${MVP_DEPS_DIR}/lib/libfreetype.a" "${MVP_DEPS_DIR}/lib/libpng16.a"
    GLESv2 z log android)
  set(MVP_PLATFORM_INCLUDES "${MVP_DEPS_DIR}/include/cairo" "${MVP_DEPS_DIR}/include/freetype2")
else()
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(SDL2 REQUIRED IMPORTED_TARGET sdl2)
  pkg_check_modules(GLES2 REQUIRED IMPORTED_TARGET glesv2)
  pkg_check_modules(CAIRO REQUIRED IMPORTED_TARGET cairo cairo-ft cairo-png)
  pkg_check_modules(FREETYPE REQUIRED IMPORTED_TARGET freetype2)
  set(MVP_PLATFORM_LIBS PkgConfig::SDL2 PkgConfig::GLES2 PkgConfig::CAIRO PkgConfig::FREETYPE pthread dl)
  set(MVP_PLATFORM_INCLUDES "")
endif()

# The WebGL constant table is generated from the OpenGL ES 2 header.
find_file(MVP_GLES2_HEADER GLES2/gl2.h REQUIRED)
set(MVP_GL_CONSTANTS "${CMAKE_BINARY_DIR}/generated/gl_constants.inc")
add_custom_command(
  OUTPUT "${MVP_GL_CONSTANTS}"
  COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_BINARY_DIR}/generated"
  COMMAND sh "${CMAKE_SOURCE_DIR}/tools/build/gen_gl_constants.sh" "${MVP_GLES2_HEADER}" "${MVP_GL_CONSTANTS}"
  DEPENDS "${CMAKE_SOURCE_DIR}/tools/build/gen_gl_constants.sh" "${MVP_GLES2_HEADER}"
  COMMENT "Generating the WebGL constant table"
)

# The Ogg Vorbis decoder is third-party C code, built without this project's
# warnings.
add_library(stb_vorbis STATIC third_party/stb/stb_vorbis.c)
target_compile_options(stb_vorbis PRIVATE -w)

set(MVP_SOURCES
  "${MVP_GL_CONSTANTS}"
  src/bindings/audio_binding.cpp
  src/bindings/video_binding.cpp
  src/bindings/canvas_binding.cpp
  src/bindings/webgl_binding.cpp
  src/bindings/gl_limits.cpp
  src/platform/main.cpp
  src/platform/audio_mixer.cpp
  src/platform/clock.cpp
  src/platform/input.cpp
  src/platform/files.cpp
  src/platform/game_library.cpp
  src/platform/log.cpp
  src/platform/button_map.cpp
  src/platform/settings_menu.cpp
  src/platform/touch.cpp
  src/platform/touch_layout.cpp
  src/platform/window.cpp
  src/platform/main_loop.cpp
  src/engine/host.cpp
)
if(ANDROID)
  # SDL's Java side loads the program as libmain.so and calls its SDL_main.
  add_library(mvplayer SHARED ${MVP_SOURCES} src/platform/android_start.cpp src/platform/video.cpp)
  set_target_properties(mvplayer PROPERTIES OUTPUT_NAME main)
else()
  add_executable(mvplayer ${MVP_SOURCES} src/platform/video.cpp)
endif()
target_include_directories(mvplayer PRIVATE src third_party/stb ${MVP_PLATFORM_INCLUDES} "${CMAKE_BINARY_DIR}/generated" "${MVP_V8_DIR}/include")
target_compile_options(mvplayer PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)
target_link_libraries(mvplayer PRIVATE
  "${MVP_V8_DIR}/lib/libv8_monolith.a"
  stb_vorbis
  ${MVP_PLATFORM_LIBS}
)
