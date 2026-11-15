# Build environment for V8 on 64-bit ARM Linux.
#
# V8 is built with the system compiler and the system C++ standard library
# (libstdc++), so that the library fits code compiled the ordinary way. V8's
# own build tooling assumes an x86 host and downloads its own compiler; none
# of that is used here. The only Google tools needed are `gclient` (to fetch
# V8 and its dependencies) and `gn` (to generate the build), and `gn` is
# built from source because no suitable binary is assumed for this host.
FROM debian:bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl git ninja-build pkg-config python3 \
      python3-httplib2 xz-utils \
    && rm -rf /var/lib/apt/lists/*

# gn, built from source with the system compiler.
RUN git clone https://gn.googlesource.com/gn /opt/gn-src \
    && cd /opt/gn-src \
    && CXX=g++ CC=gcc AR=ar /usr/bin/python3 build/gen.py --allow-warnings \
    && ninja -C out gn \
    && install -m 0755 out/gn /usr/local/bin/gn \
    && rm -rf /opt/gn-src

# gclient, used only to fetch V8 and its dependencies. It is run with the
# system Python (see build.sh); depot_tools ships its own `python3` wrapper
# that needs a bootstrap step, so the folder is deliberately not put first
# on PATH. Auto-update is disabled so the image stays as built.
ENV DEPOT_TOOLS_UPDATE=0
RUN git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git /opt/depot_tools
ENV PATH="${PATH}:/opt/depot_tools"

WORKDIR /work
