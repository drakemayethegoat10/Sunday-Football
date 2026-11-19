# Roadmap

Each milestone ends with something playable on GitHub Pages. The PC (Bevy) client
starts after Milestone 1, once the core API has settled, and then keeps pace with the web build.

## M0 — Foundation ← *current*
- [x] Design doc, roadmap, proposed league
- [x] Rust workspace: `sf-core` (simulation) + `sf-wasm` (browser bindings)
- [x] Vite + TypeScript + Three.js web client that loads the WebAssembly core
- [x] PS2-retro field and stadium, plus 22 low-poly players with procedural run animation
- [x] Play loop: call a play → snap → run/pass → tackle → down and distance → next play
- [x] User-controlled offense (QB, then ball carrier) and defense (switchable defender)
- [x] Bucket-passing solver with tap/hold throws, 1–5 keys or click-to-throw
- [x] CPU offense and defense play-calling, CPU QB reads, pursuit, blocking, coverage
- [x] Score bug, clock, quarters, touchdowns, punts and field goals (auto-resolved)
- [x] GitHub Actions workflow that builds the WebAssembly core and deploys to Pages

## M1 — Exhibition game
- Kickoffs, punts, field goals, PATs and 2-point tries played on the field
- Full clock rules, timeouts, two-minute warning, overtime
- Penalties (first set: false start, offside, holding, pass interference) + sliders
- Bigger playbooks (several formations and personnel groups per scheme)
- Menus: team select, settings, sliders, controls; Xbox controller support on web
- Quality presets with auto-detection; installable offline web app

## M2 — Feel
- Physics tackling (Rapier): hit angles, momentum, gang tackles, big-hit fumbles
- Animation system: blended locomotion, catches, throws, tackles, celebrations
- Ball-carrier move set (hurdle, truck, cutbacks), pass-rush moves, coverage disguises
- Pass-placement controls (lead, back shoulder, high/low)
- Instant replay; camera presets polished

## M3 — League data
- 32 teams (after TEAMS.md is approved), Sarasota branding from the owner
- Player generation: ratings, archetypes, personalities, potential
- Rosters, depth charts, roster editor
- Saves: IndexedDB plus export/import file

## M4 — Season engine
- Schedule generator, fast sim engine for CPU games, box scores, full stats
- Standings, tiebreakers, playoffs, awards
- Injuries and recovery, practice squad

## M5 — Front office
- Salary cap, contracts, negotiation, holdouts, restructures, dead money
- Free agency with AI bidding; trades with AI GMs that have team needs
- Scouting (hidden ratings, scouts of varying accuracy), combine and pro days, draft
- Coaching staff hiring and firing; staff ratings affect development and schemes
- Progression, aging, retirement

## M6 — Careers and story
- Pick a role (Coach / GM / Owner), job security, owner goals, firings and new jobs
- Career moves (coach → GM/Owner); retired players become position-appropriate coaches
- Weekly news, storylines, team chemistry, player personalities and morale
- Optional weekly game-plan prep
- Records, Hall of Fame, history archive

## M7 — Creation suite
- Create-a-Player, Create-a-Team (logo/uniform editor), Create-a-Play (play designer),
  Create-a-Stadium, Create-a-Fan

## M8 — Presentation
- Weather, night games, stadium variety, momentum-aware crowd
- Celebrations, halftime highlights, cutscenes
- Text ticker; hook for local voice-AI commentary (PC first)
- Music and sound pass

## M9 — Local 2-player
## M10 — PC client (Bevy) to feature parity, Ultra graphics, modding tools
## M11 — Online head-to-head, then online franchise leagues
