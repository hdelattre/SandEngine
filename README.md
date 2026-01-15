# sandengine (V1)

Pure HTML/CSS/JS sandbox particle simulation (no dependencies).

## Run

From this folder:

```sh
python -m http.server
```

Then open `http://localhost:8000`.

## Notes

- WebGL2 is required (the simulation runs on the GPU via ping-pong textures).
- Paste an image with Ctrl/Cmd+V to stamp it into particles (Shift+Paste to avoid scaling).
