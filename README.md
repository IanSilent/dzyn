# ДЗЫНЬ

**Play in the browser: https://iansilent.github.io/dzyn/**

A personal web prototype: a satirical racing/flow game about an e-scooter rider who terrorises pedestrians.
Stage 1 is the core movement: does riding feel good?
The world is one endless straight street that goes forward (up-right on screen); the HUD counts the distance.

## Passengers

Hitchhikers wave by the street with a green «+1» over their heads. Ride into one and they climb onto your
shoulders. The next one climbs onto theirs, and so on, up to 12: a tower of people on one scooter.

- Every passenger adds 25% to every payout and makes the bell reach further. The scooter gets a bit slower.
- The tower sways. Each swing of the nose shoves it, and a taller tower swings wider and slower.
  One dodge is fine; weaving in rhythm with the sway throws the top people off.
- A lamp or a tree at a passenger's height knocks off that passenger and everyone above. They are rare.

## Feedback

Near misses and the bell are meant to feel good: a burst of sparks, hearts that fly into the stream counter
and make it jump, a zoom punch, a coloured glow at the screen edges, and a brief slow motion on a really close
call. Annoying people in a row builds a streak with big words in the middle of the screen (СЕРИЯ ×N, ОГОНЬ,
БЕЗУМИЕ…) and a chime that climbs with it. The bell sends a double shock wave and puts a «!» over every head
it hits; three or more is ПАНИКА.
- A crash throws the whole tower. Fallen passengers get up and walk off grumbling.

## Run

Double-click `index.html`, or serve the folder (`python3 -m http.server 8778`) and open http://localhost:8778.
No build step, no dependencies.

## Controls

| Key | Action |
|---|---|
| (nothing) | full throttle all the time, no brake |
| A / D or ← / → | toward the left / right side of the street; release and the nose returns forward |
| Space | hop (a 360 or a tailwhip happens by itself, sized to the airtime; tricks never make you fall); keep holding it through the landing while steering → drift; release → boost |
| E (or F) | the bell, «ДЗЫНЬ»: scares pedestrians within ~6.5 m |
| land along a bench or ledge | grind; Space to pop off |
| ride into a «+1» hitchhiker | they climb onto the tower |
| R | new run from the start |
| C | switch control scheme: street (default), handlebar (W/S gas and brake, A/D turn), screen (WASD point the way) |
| M | sound on/off |
| ` | tuning panel: every movement number as a slider, saved in the browser |

## Layout

- `src/config.js` — all tunable numbers and the tuning panel list
- `src/world.js` — the endless street, generated in chunks ahead and dropped behind; ground height and collisions
- `src/player.js` — scooter physics, drift/boost, hops, ramps, tricks, grind, crashes
- `src/peds.js` — pedestrians, their reactions and lines
- `src/score.js` — the stream combo (pool × multiplier → likes)
- `src/tower.js` — passengers: pickup, the swaying tower, falls
- `src/game.js` — fixed-step simulation, near misses, bell, camera
- `src/render.js` — isometric canvas renderer
- `src/audio.js`, `src/ui.js`, `src/input.js`, `src/main.js` — sound, HUD, keyboard, loop
- `tools/check.js` — headless checks: `node tools/check.js`
