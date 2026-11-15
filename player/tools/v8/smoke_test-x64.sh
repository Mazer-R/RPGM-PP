#!/bin/sh
# Compiles smoke_test.cc for x86-64 against the V8 library produced by
# build-x64.sh and runs it through the host's x86-64 emulation. Meant to run
# inside the image built from Dockerfile.x64, with the same folders mounted:
#   /work/tools this folder, /work/out the V8 headers and library.
# The binary is left at /work/out/smoke_test.
set -eu
x86_64-linux-gnu-g++ -std=c++20 -O2 -I/work/out/include /work/tools/smoke_test.cc \
    -o /work/out/smoke_test \
    -L/work/out/lib -lv8_monolith -pthread -ldl
ls -l /work/out/smoke_test
/work/out/smoke_test
