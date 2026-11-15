# rpgmaker-player

Feasibility study for running RPG Maker MV games on low-memory Linux
handhelds (reference device: Anbernic RG35XX SP, 1 GB RAM, muOS) without the
Chromium-based NW.js player the games ship with.

This repository holds measurements and throwaway experiments, not a player.
Nothing here has been run on the device yet.

## Contents

- `concepts_brief.md` — the idea, the review findings, and every measurement
  with its limits. Start with "Key Decisions & Staging for Next Steps".
- `lab/` — the experiments behind those measurements:
  - `Dockerfile`, `run.sh`, `probe.sh`, `serve.py`, `harness.js`, `probes/` —
    run a game under WPE WebKit in an ARM64 container and measure memory and
    frame time.
  - `chrome-heap.mjs` — JavaScript heap snapshots through a Chromium-based
    browser.
  - `overlays/event-culling.js` — in-memory patch that skips far-away map
    events.
  - `minimal/` — runs a game's own scripts in bare Node with stand-in browser
    objects, optionally with a real Canvas 2D library and a WebGL library.

## Game files

No game data, engine scripts or plugins are included, and none may be
committed. The experiments expect your own copy of a game's `www` folder at
`lab/game/www`, which is ignored by git along with all experiment output.

## Status

Experimental. See the brief for what is measured, what is estimated, and what
is still unknown.

---

# rpgmaker-player (español)

Estudio de viabilidad para ejecutar juegos de RPG Maker MV en consolas Linux
con poca memoria (dispositivo de referencia: Anbernic RG35XX SP, 1 GB de RAM,
muOS) sin el reproductor NW.js basado en Chromium con el que se distribuyen.

Este repositorio contiene mediciones y experimentos desechables, no un
reproductor. Nada de lo que hay aquí se ha ejecutado todavía en la consola.

## Contenido

- `concepts_brief.md` — la idea, los hallazgos de la revisión y cada medición
  con sus límites. Empieza por "Key Decisions & Staging for Next Steps".
- `lab/` — los experimentos que respaldan esas mediciones:
  - `Dockerfile`, `run.sh`, `probe.sh`, `serve.py`, `harness.js`, `probes/` —
    ejecutan un juego bajo WPE WebKit en un contenedor ARM64 y miden memoria y
    tiempo por fotograma.
  - `chrome-heap.mjs` — instantáneas del heap de JavaScript mediante un
    navegador basado en Chromium.
  - `overlays/event-culling.js` — parche en memoria que omite los eventos
    lejanos del mapa.
  - `minimal/` — ejecuta los scripts del propio juego en Node, con objetos que
    sustituyen al navegador y, opcionalmente, una librería real de Canvas 2D y
    otra de WebGL.

## Archivos del juego

No se incluyen datos de ningún juego, ni scripts del motor, ni plugins, y no
deben subirse. Los experimentos esperan tu propia copia de la carpeta `www`
de un juego en `lab/game/www`, que git ignora junto con toda la salida de los
experimentos.

## Estado

Experimental. Consulta el brief para ver qué está medido, qué está estimado y
qué sigue sin conocerse.
