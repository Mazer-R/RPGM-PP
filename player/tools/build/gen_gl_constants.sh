#!/bin/sh
# Generates the table of WebGL constant names and values from the OpenGL ES 2
# header, so the values are never typed by hand. WebGL uses the same names
# without the GL_ prefix. Usage: gen_gl_constants.sh <gl2.h> <output.inc>
set -eu
{
  echo "// Generated from $(basename "$1") by gen_gl_constants.sh. Do not edit."
  sed -n -E 's/^#define[[:space:]]+GL_([A-Z0-9_]+)[[:space:]]+(0x[0-9A-Fa-f]+|[0-9]+)[[:space:]]*$/{"\1", \2},/p' "$1"
} > "$2"
