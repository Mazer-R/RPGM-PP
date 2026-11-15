# Experiment image: WPE WebKit (cog launcher) on ARM64 Linux with software GL.
# Used to measure whether an RPG Maker MV game runs under WPE and how much
# memory it needs. Game files are mounted at run time and never copied in.
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      cog libwpewebkit-2.0-1 libgles2 libegl1 libegl-mesa0 libgl1-mesa-dri \
      gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-libav \
      python3 procps ca-certificates fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -m player
USER player
WORKDIR /lab
