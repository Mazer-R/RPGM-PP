# CMake toolchain file for cross-compiling the player to x86-64 Linux from a
# 64-bit ARM Debian system that has the amd64 development packages installed
# through multiarch (see Dockerfile.x64 next to this file).
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_CXX_COMPILER x86_64-linux-gnu-g++)

# pkg-config that answers for the amd64 libraries, not the native ones.
set(PKG_CONFIG_EXECUTABLE /usr/bin/x86_64-linux-gnu-pkg-config)

# Programs run during the build are the host's; libraries are the target's.
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_LIBRARY_ARCHITECTURE x86_64-linux-gnu)
