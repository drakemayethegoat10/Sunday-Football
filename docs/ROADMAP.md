# Roadmap

Each milestone ends with something playable on GitHub Pages. The PC (Bevy) client
starts after Milestone 1, once the core API has settled, and then keeps pace with the web build.

## M0 — Foundation ✅
Rust core + WebAssembly + Three.js client, PS2-style graphics, playable exhibition, Pages deploy.

## M1 — Exhibition game ✅
- [x] Kickoffs (deep, squib, onside), punts and field goals played on the field, with a
      three-press power/accuracy kick meter, returns, fair catches, touchbacks, muffs,
      onside recoveries and blocked kicks
- [x] Extra points and 2-point tries
- [x] Clock rules: two-minute warning, out-of-bounds stops late in halves, hurry-up and
      clock-killing pace, kneel and spike
- [x] Timeouts (3 per half, 2 in overtime); the CPU uses them when trailing
- [x] Overtime: both teams get a possession, then sudden death; ties possible
- [x] Penalties: false start, offside, offensive/defensive holding, pass interference,
      with accept/decline logic and half-the-distance; frequency slider
- [x] Bigger playbooks: 8 formations / 4 personnel groups, about 40 offensive plays
      (toss, counter, FB dive, QB sneak, HB screen, bootleg, stick, Y-cross, dagger...),
      17 defensive calls across 4-3, Nickel, Dime and Goal Line
- [x] Formation-first play-call menu with tabs and a timeout button
- [x] Difficulty (Rookie → Legend), penalty and overtime settings
- [x] Xbox Series X|S / Xbox 360 controller support (receiver icons switch to A/B/X/Y/RB)
- [x] Installable offline web app (manifest + service worker)
- [x] Quality presets with auto-detection
- Known for M2: kick returns average about 13 yards (low); scoring runs a bit low in short games.

## M2 — Feel ✅
- [x] Physics tackling: momentum/angle contact model (big hits, wrap-ups that drain the
      carrier's balance while he drives for yards, broken tackles, gang tackles), then real
      ragdolls (Rapier, 11 bodies per player, grab joints between tacklers and carrier)
- [x] Forward progress from physics: the ball is spotted where it is when a knee, hip,
      torso or head touches the turf
- [x] Fumbles from big hits and gang-tackle strips, with a live bouncing ball and recoveries
- [x] Ball-carrier moves: hurdle (beats diving tacklers, risky in the air), truck, plus
      juke / spin / stiff arm; stagger after broken tackles
- [x] Pass-rush moves: swim, spin, bull rush (user and CPU)
- [x] Coverage disguises: safeties show a different shell before the snap
- [x] Pass placement: hold a direction while throwing to lead / back-shoulder the ball
- [x] Animation: backpedal and side-shuffle footwork, throw wind-up/follow-through,
      wrap-up, hurdle, truck and stagger poses, four celebration styles, ragdoll posing
- [x] Instant replay (pause, scrub, slow-mo, 4 cinematic cameras)
- [x] Camera: lookahead, hit shake, pull-back on kicks and deep balls
- [x] Kick returns fixed (return team blocks the coverage); scoring back to realistic levels
- Known: CPU rushing varies a lot game to game (about 3 yards per carry on average).

## Polish before M3 ✅
- [x] Puck engine: every player is a physical circle; collisions trade momentum, blocking
      is a push-and-leverage fight between circles, tackle reach is measured from their
      edges, jukes are acceleration bursts, and bodies lean with their circle
- [x] Pass rush fixed: a quarterback who just holds the ball now gets about 3.5–4 s
      before pressure (it was about 1.4 s); quick sacks only come from unblocked blitzers.
      Linemen kick-slide to cut off rushers; CPU quarterbacks feel pressure and throw
      it away
- [x] New kick meter: aim arrow on the field, arc power meter with the landing ring
      moving out as power fills, then stop the marker in the sweet spot
- [x] Pass target marker (gold) and kick landing marker (cyan) with a dotted flight path
- [x] Ball carried high and tight in the carrying arm; QB holds it at the chest in the pocket
- [x] "Player circles" option in the pause menu to see the engine
- Pocket report: `cargo test -p sf-core --release --test pocket -- --ignored --nocapture`
- Known: CPU rushing is low (about 2.5 yards per carry) and CPU passing a bit high
  (about 8.5 yards per attempt); next tuning pass.

## Visual polish ✅ *(current)*
- [x] Camera swings behind the new ball carrier mid-play on interceptions, fumble
      recoveries and kick returns (the stick keeps its direction during the swing)
- [x] Detailed player model: smooth-bending limbs and torso, hands with thumbs, cleats,
      face behind an open helmet with a three-bar facemask, numbered shoulder caps,
      towels and neck rolls by position
- [x] New animation system: leg IK with planted feet, gait blending, backpedal, shuffle,
      crossover runs, head tracking, catch reaches, get-ups, position stances, QB throw
      and kicker swing, ball carried in the sideline-side arm

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
