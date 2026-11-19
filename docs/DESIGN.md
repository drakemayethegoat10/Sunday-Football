# Sunday Football — Design Document

> An original pro-football game. Its franchise mode is as deep as the classic mid-2000s
> franchise sims, and its on-field play aims for smooth animation, physics-driven
> tackling, and precise "drop it in the bucket" passing.
> It runs in a browser on a school Chromebook (GitHub Pages) and natively on a Linux PC.

This document records the decisions made with the project owner. Anything marked
**(default)** was not specified and can be changed at any time.

---

## 1. Platforms

| | Web (primary, ships first) | PC (native) |
|---|---|---|
| Hardware | School Chromebook. Model and GPU unknown, so the game auto-detects quality | Linux Mint 22.3, RTX 4050 Laptop, i5-13420H, 16 GB |
| Tech | Rust core → WebAssembly, rendered with **Three.js** | Rust core + **Bevy / wgpu** renderer |
| Input | Keyboard + mouse/touchpad assists | Xbox Series X\|S and Xbox 360 controllers, keyboard |
| Hosting | GitHub Pages: `drakemayethegoat10.github.io/Sunday-Football` | Local build (later: release binaries) |
| Goal | Squeeze as much as possible out of the web build | Better graphics, deeper simulation, modding tools |

Both versions run **the same Rust core**, so rules, AI and franchise logic are written once.
Save files work in both versions, so a franchise started on the Chromebook can continue on the PC.

## 2. Architecture

```
crates/
  sf-core/      Pure Rust. No graphics, no browser APIs.
                Rules, game state, on-field simulation, AI, (later) physics, franchise, saves.
  sf-wasm/      Thin wasm-bindgen wrapper that exposes sf-core to JavaScript.
  sf-desktop/   (later) Bevy app that drives sf-core directly.
web/            Vite + TypeScript + Three.js: rendering, input, menus, audio.
data/           Shared JSON data (teams, branding) used by both clients.
docs/           This file, ROADMAP.md, TEAMS.md.
```

* The core runs a **fixed 60 Hz simulation**. Each frame the client sends an `Input` struct
  and reads back a compact float buffer (positions, facing, animation state) plus
  JSON events (tackle, catch, touchdown...).
* The core is deterministic (seeded RNG). That makes replays, online play and
  bug reproduction possible later.
* Coordinates are in **yards**. x runs 0–120 along the field (goal lines at 10 and 110),
  y runs 0–53⅓ across it, and z is height.

## 3. On-field gameplay pillars

1. **Smooth, weighty movement.** Acceleration, top speed, cutting and momentum come from
   ratings, so stars feel like stars.
2. **Physics-based tackling, like Backbreaker.** Milestone 0 resolves tackles with
   rating-driven contact math. Milestone 2 replaces this with a real physics layer
   (Rapier, which also compiles to WebAssembly): active-ragdoll-style bodies, hit angle
   and momentum, forward progress, gang tackles, and fumbles from big hits.
   The web build runs physics only for players in or near contact.
3. **"Bucket" passing.** The QB solves a real ballistic throw to a point where only the
   receiver can get it. He leads the receiver, puts the ball away from the nearest
   defender, and lofts it over underneath coverage. Ratings, pressure and throwing on the
   run add error.
   Throw types: **tap = bullet**, **short hold = touch**, **long hold = lob** **(default)**.
4. **Ball-carrier moves.** Juke, spin and stiff arm at first; hurdle, truck and
   cut-backs come later.
5. **Adjustable camera.** The default is a broadcast camera behind the offense. The
   player can change its zoom, height and preset, and the setting is saved.

### Rules
Full pro rules with **sliders**: penalty rates, game speed, injury rate, CPU skill per
skill area, fatigue. Quarter length defaults to 5 minutes with an accelerated clock
**(default)**, and is adjustable.

### Default web controls

| Action | Key |
|---|---|
| Move | WASD / Arrow keys |
| Sprint | Shift |
| Snap / Juke / Dive tackle | Space |
| Spin | Q |
| Stiff arm | E |
| Throw to receiver | 1–5 (tap = bullet, hold = lob), or **click the receiver** |
| Switch defender | Tab |
| Camera preset / zoom | V / `-` `=` |
| Pause | Esc / P |

## 4. League

* **Fictional 32-team league.** Real cities, original nicknames, colors and logos.
  No real league teams, logos or players. See [TEAMS.md](TEAMS.md); the owner approves names.
* The owner's team is **Sarasota Seaman**. The owner provides its logos and branding.
* Default structure: 2 conferences × 4 divisions × 4 teams, a 17-game season,
  3 preseason games and 14 playoff teams. **Everything is customizable** when a league
  is created.
* Players are procedurally generated. A full editor lets the user rename or edit
  anything in their own save.

## 5. Franchise mode (must-haves)

**Front office:** salary cap, contract negotiation, holdouts, cuts, dead money,
restructures. Scouting with hidden prospect ratings and scouts of varying accuracy,
combine and pro days, draft-day trades. Free agency and trades with AI general managers
that have team needs, plus bidding wars. Coaching staff (coordinators, position coaches,
scouts, trainers) whose ratings affect development and schemes.

**Season life:** progression, potential, aging, retirement, morale. Injuries with
recovery timelines, depth chart, practice squad. Full stats, records, awards, Hall of
Fame, archive of past seasons. Weekly news and storylines, owner goals, job security,
fan support. **Optional weekly game-plan prep. Team chemistry. Player personalities.**

### Careers and roles
* Before starting a franchise, the user picks a role: **Coach**, **GM** or **Owner**.
* Careers can change over time. For example, a coach with a long career can retire and
  return as a GM or Owner.
* **Retired players can become coaches, in roles that fit their playing position:**

| Played | Can become |
|---|---|
| QB | QB coach → passing-game coordinator / OC → HC |
| RB | RB coach → run-game coordinator / OC → HC |
| WR, TE | WR/TE coach → passing-game coordinator / OC → HC |
| OL | OL coach → run-game coordinator / OC → HC |
| DL | DL coach → DC → HC |
| LB | LB coach → DC → HC |
| CB, S | DB coach → DC → HC |
| K, P | Special-teams coordinator → HC (rare) |

  Moving up to coordinator and head coach depends on experience, results and personality.

## 6. Creation suite
Create-a-**Player**, create-a-**Play** (play designer), create-a-**Team** (name, colors,
logo, uniforms), create-a-**Stadium**, and create-a-**Fan** (put custom people in the
stands, shown on crowd shots and in highlights).

## 7. Presentation
All of the following: score bug, replays, celebrations, weather that affects play
(rain, snow, wind), night games, stadium variety, halftime highlights, and a crowd that
reacts to momentum.
**Commentary:** the user chooses between a **text play-by-play ticker** and **voiced
commentary**. Voice will be hooked up to a local voice-AI engine (PC first). The core
emits structured play-by-play events, so either output can use them.

## 8. Art direction
* **Web: PS2-era.** Specified by the owner:
  1. **Render pipeline:** the 3D scene renders at an internal **640×448** and is upscaled
     with bilinear filtering. Pixels are anamorphic on widescreen, like PS2 widescreen.
     Subtle distance fog, plus a soft bloom pass on bright highlights.
  2. **Turf & lighting:** worn, textured grass with dirt wear between the hashes and in
     the goal mouths, scuffed paint, and directional stadium floodlighting (warm key,
     cool fill, rim). Helmets are glossy (Phong). Players get soft AO blobs plus floodlight
     cast shadows.
  3. **Atmosphere:** sky dome gradient with clouds, two-tier stands with a colorful crowd
     that bounces on big plays, glowing ribbon billboards (league/team names only, no real
     brands), a jumbotron with the live score, lattice light towers, team benches,
     coolers, a chain gang with a down box, and sideline squads in warm-up jackets.
  4. **Players:** athletic low-poly proportions: V-shaped torso, shoulder pads with caps,
     helmets with facemask cage and stripe, bent-knee stances. Each player has a painted
     uniform texture (shaded jersey fabric, numbers, stripes). One skinned body plus one
     helmet per player, so just 2 draw calls.
  5. **HUD:** an early-2000s TV broadcast package: top scorebug, lower-third
     play-by-play, swoosh banners, and a play-call menu with bold condensed italics
     (Barlow Condensed, bundled and OFL-licensed), beveled glossy gradient panels, and
     drop shadows.
* Quality levels: Low 512×358 · **PS2 640×448 (default)** · High 960×672 · Ultra (native).
  Auto mode starts at PS2 and drops to Low only if a Chromebook can't hold 45 fps.
* **PC: the same art, made sharper (default).** Native resolution, real shadows, better
  lighting, more crowd detail, higher-detail options added over time.
* All art, audio and animation is original. It is made procedurally, in Blender, or
  comes from properly licensed (CC0/CC-BY/OFL) sources.

## 9. Multiplayer
* Vs CPU and **local 2-player** (same device: shared keyboard or controllers).
* **Online head-to-head** and **online franchise leagues** come late in the plan.
  GitHub Pages can't run a server, so these need an outside service, chosen later.

## 10. Saves
**(default)** Auto-save to browser storage (IndexedDB), plus **Export/Import** of a save
file. The same file loads in the PC version.

## 11. Ground rules for originality
* This is an original game in the football-sim genre. Mechanics and depth are inspired
  by classic games, but we never copy their names, menus, presentation, art, audio or
  branding.
* No real league marks, team names, logos, or real player names/likenesses ship in the
  repo or on the website.

## 12. Open questions
* Chromebook model and GPU are unknown. The game will auto-detect and scale. Once the
  game is live, the owner should check `chrome://gpu` at school.
* Team name check: should it be "Sarasota **Seaman**" (singular, as given) or
  "Sarasota **Seamen**"?
* PC art direction: "same art, sharper" is the default. Should the PC version move to a
  more realistic look later?
