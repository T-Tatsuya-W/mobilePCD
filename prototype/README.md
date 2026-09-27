# Interaction prototype

Standalone mobilePCD control and torus experiment. Serve the repository over HTTP/HTTPS and open `/prototype/` (or `https://t-tatsuya-w.github.io/mobilePCD/prototype/` on GitHub Pages).

- The **theta slider** lives in the **theta slider panel** and sets θ. The torus sits in the **torus window panel**. The **main panel** contains the radar pad, θ/Φ/r readouts and a Settings button.
- The 12 chromatic note nodes come from `./json/notes.json`; the 24 major/minor chord nodes come from the isolated copy `./json/chords.json`. Each note began as a one-hot, 12-bin PCD and was transformed with the local copy of `pcd-dft.js`.
- `torus-coordinates.js` maps DFT bins to θ = phase 5, Φ = phase 3, r = magnitude 3. Its `toroidalToCartesian(theta, phi, r)` function maps these values to the prototype torus in the XY plane. r = 0 is the tube centreline, r = 1 its surface; Φ = 0 points outward.
- The renderer and all of its data and transformation code live inside `prototype/`. The root `json/notes.json` is populated in the same schema as `json/chords.json` for the existing app.
- The Settings button overlays fixed-range major and minor radius sliders on the torus window. Their changes update the mesh, all plotted nodes, the red θ slice and the pointer; torus geometry is disposed when replaced.
- A single reusable red marker follows θ, Φ and r from the controls. It dims when the radar is released; dragging the view only changes the camera pose of the same marker.
- The theta slider marker shares the phase-5 hue mapping with plotted torus nodes. The radar plots visible-category nodes by Φ and r, fading them linearly with circular θ distance; its range is adjustable from 0.01π to 0.50π.
- The original IMV205 connection indices are copied to `./json/connections.json`: 36 distinct note intervals and 36 distinct chord pairs (the 72 directional chord entries are drawn once per pair). Independent connection checkboxes show lines for visible node categories; lines update when the torus radii change.
- The settings overlay scrolls and offers Notes, Chords or Both; plotted nodes use phase 5 (θ) for hue, and translucent labels are centered on their markers; chord labels abbreviate Major/minor as M/m. The Note names setting switches sharp and flat spelling for notes and chords without moving nodes. Empty Mic to torus and Torus to audio sections reserve room for future controls.
- The prototype does not yet connect live microphone PCD to the plotted note positions.
