# Sunday Football — notes for Claude

The owner directs and playtests; Claude writes the code. Read `docs/DESIGN.md` (decisions)
and `docs/ROADMAP.md` (milestones) before starting work.

## Layout
- `crates/sf-core`: all game logic in pure Rust (rules, on-field sim, AI, later franchise).
  No graphics or platform code: it must stay shareable with the future Bevy PC client.
- `crates/sf-wasm`: thin wasm-bindgen wrapper (`WebGame`). Keep logic out of it.
- `web/`: Vite + TypeScript + Three.js client (render, input, UI, audio). `web/src/wasm/` is generated.
- `data/teams.json`: fictional league identity (names/colors), shared by both clients.

## Commands
- Core tests: `cargo test -p sf-core --release`
- Tuning report: `cargo test -p sf-core --release --test tuning -- --ignored --nocapture`
- Build WebAssembly: `scripts/build-wasm.sh` (wasm-bindgen CLI must match Cargo.lock)
- Web dev server: `cd web && npm run dev` (rebuilds wasm first) or `npm run serve`
- Production build: `cd web && npm run build` → `web/dist`
- Rust lives in `~/.cargo/bin`; run `. "$HOME/.cargo/env"` in a fresh shell.

## Conventions
- Core units are yards and seconds. Field x 0–120 (goal lines at 10/110), y 0–53.33, z up.
  Three.js maps core (x, y, z) → (x, z, -y).
- Sim runs at a fixed 60 Hz and is deterministic (seeded `Rng`), so never use wall-clock or
  thread RNG in sf-core.
- Ratings are 0–99. Tune gameplay with the tuning report; realistic targets are about
  6–7.5 yards per pass attempt, 3.5–4.5 yards per carry, and 17–28 points per team.
- Originality: fictional teams/players only; never real league marks, names or likenesses,
  and never copy another game's names, menus, art or audio.
- Browser storage access must be wrapped in try/catch (school Chromebooks may block it).
- The browser pane can't run scripts while hidden; for headless checks, load
  `web/src/wasm` in Node (see `wasm-bindgen --target web` init with bytes).
