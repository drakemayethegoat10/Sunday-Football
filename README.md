# Sunday Football

An original pro football game built with **Rust + WebAssembly + Three.js**. It runs in the
browser (including school Chromebooks) via GitHub Pages, and a native PC version is planned.

**Play:** https://drakemayethegoat10.github.io/Sunday-Football/ *(after the first deploy)*

- Franchise-mode depth in the spirit of the classic mid-2000s football sims (coming in milestones 3–6)
- Smooth on-field play: physics-style tackling, "bucket" passing, an adjustable broadcast camera
- Fictional 32-team league (see [docs/TEAMS.md](docs/TEAMS.md))

See [docs/DESIGN.md](docs/DESIGN.md) for the design and [docs/ROADMAP.md](docs/ROADMAP.md) for progress.

## Controls (web)

| Action | Key |
|---|---|
| Move / sprint | WASD or arrows / Shift |
| Snap · juke · dive | Space |
| Spin · stiff arm | Q · E |
| Throw | 1–5 or click a receiver (tap = bullet, hold = lob) |
| Switch defender | Tab |
| Camera · zoom | V · `-` `=` |
| Pause / controls | Esc |

## Building locally

Requires Rust (with the `wasm32-unknown-unknown` target), `wasm-bindgen-cli` matching
`Cargo.lock`, and Node 22+.

```bash
cargo test -p sf-core --release        # core tests (includes full CPU-vs-CPU games)
cd web && npm install && npm run dev   # builds the WebAssembly core, then starts Vite
```

Licensed under GPL-3.0.
