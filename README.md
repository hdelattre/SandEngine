# SandEngine

Play at https://hdelattre.github.io/SandEngine/

Pure HTML/CSS/JS “falling sand” particle simulation with a WebGL2 GPU backend and no external dependencies.

## Run

From this folder:

```sh
python -m http.server
```

Then open `http://localhost:8000`.

## Repo overview

- `index.html` / `styles.css`: minimal UI + layout.
- `src/main.js`: app wiring, input handling, UI state, and rendering loop.
- `src/gpu-sim.js`: GPU simulation engine (ping-pong textures, stepping, painting, stamping, rendering).
- `src/shaders.js`: GLSL compute-style fragment shaders for matter + heat + rendering.
- `src/particles.js`: particle definitions and lookup tables packed into textures.
- `src/types.js`: JSDoc type spec for the project (editor tooling; not TypeScript).
