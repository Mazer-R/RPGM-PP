#!/bin/sh
# Compiles smoke_test.cc against the V8 library produced by build.sh and runs
# it. Meant to run inside the build image, with the same folders mounted:
#   /work/tools this folder, /work/out the V8 headers and library.
# The binary is left at /work/out/smoke_test so it can be copied to the
# handheld and run there too.
set -eu
g++ -std=c++20 -O2 -I/work/out/include /work/tools/smoke_test.cc \
    -o /work/out/smoke_test \
    -L/work/out/lib -lv8_monolith -pthread -ldl
ls -l /work/out/smoke_test
/work/out/smoke_test
