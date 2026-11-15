cmake_minimum_required(VERSION 3.20)
project(mvplayer CXX)

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

find_package(PkgConfig REQUIRED)
pkg_check_modules(SDL2 REQUIRED IMPORTED_TARGET sdl2)
pkg_check_modules(GLES2 REQUIRED IMPORTED_TARGET glesv2)

add_executable(mvplayer
  src/platform/main.cpp
  src/platform/clock.cpp
  src/platform/log.cpp
  src/platform/window.cpp
  src/platform/main_loop.cpp
  src/engine/host.cpp
)
target_include_directories(mvplayer PRIVATE src "${MVP_V8_DIR}/include")
target_compile_options(mvplayer PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)
target_link_libraries(mvplayer PRIVATE
  "${MVP_V8_DIR}/lib/libv8_monolith.a"
  PkgConfig::SDL2 PkgConfig::GLES2
  pthread dl
)
