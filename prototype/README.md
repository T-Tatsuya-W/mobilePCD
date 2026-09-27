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
- The settings overlay scrolls and offers independent Plot notes and Plot chords checkboxes; plotted nodes use phase 5 (θ) for hue, and translucent labels are centered on their markers; chord labels abbreviate Major/minor as M/m. The Note names toggle switches sharp and flat spelling for notes and chords without moving nodes. Empty Mic to torus and Torus to audio sections reserve room for future controls.
- The live microphone PCD drives its own torus marker alongside the reference notes and chords.

- Radar range sits in its own settings section. Start mic requests live audio input; a red indicator in the torus window brightens with RMS volume. An 8192-sample circular analysis buffer holds only the latest input window, without recording it or audibly routing it to output. Stop mic or leave the page to release the stream and audio context. Microphone input requires HTTPS and browser permission.

- Mic light sensitivity (1×–30×, default 7×) scales the live RMS level used only for the red indicator. It does not change captured audio or future PCD analysis.

- Live mic input now goes through an isolated copy of the existing AudioProcessor (8192-sample FFT, 2048-sample hop). It computes 12 pitch-class weights, converts them with the prototype PCD DFT to θ=phase 5, Φ=phase 3, r=magnitude 3, and moves one persistent white torus marker. Silence hides the marker. The controls tune minimum RMS, pitch-bin threshold, contrast, smoothing, frequency bounds and A4 reference; the separate light sensitivity changes only the red input light. The latest PCD replaces the previous one and the renderer uses at most 20 updates per second. No audio history is stored.

- A compact 12-bin PCD strip overlays the bottom of the torus window. The PCD display button switches between live mic pitch-class weights and a pointer-derived approximation. Pointer reconstruction uses DC magnitude 1, third harmonic magnitude r and phase Φ, and fifth harmonic magnitude 1 and phase θ; unavailable harmonics remain zero, negative inverse values are clipped and the positive bins renormalized. The display reflects the sharp/flat label setting and retains only the latest mic frame.

- The PCD strip defaults to the pointer reconstruction, so it displays bars before the microphone starts. The torus settings overlay leaves the strip exposed while open; use its PCD display button to view the live mic PCD instead.

- PCD bar heights are scaled to the strongest current pitch class so quiet/spread-out PCDs remain visible; the underlying values stay unchanged. The mic display reports waiting for frames, low input level, missing pitch bins, or analysis errors instead of silently showing empty bars.

- PCD bars are red for the pointer source and blue for the microphone source; there is no title in the strip. The Show PCD checkbox hides the strip and gives the settings overlay the full torus window height. Mic analysis status remains in the Mic to torus settings section.

- The PCD strip is now about half as tall. Torus to audio uses the same pointer-derived 12-bin PCD with sustained Web Audio sine voices, following the older babysynth's MIDI pitch-class convention (C4 = MIDI 60), but changes each voice's gain continuously instead of retriggering a sound on every drag. Start/Stop audio is independent of the mic and PCD display; note threshold, output volume and octave 2–6 checkboxes control the output. Audio nodes exist only while output is on and are released on stop/page exit.

- The microphone torus marker keeps its last valid position and dims to grey when input is silent or capture stops. New valid audio brightens and moves that same marker again; torus size edits still reposition it.

- Start audio arms the output, and the pointer PCD sounds only while the radar is held; releasing or losing pointer capture fades all notes out. Active note levels are scaled to the strongest selected pitch class so the default output is audible, while output volume still sets the master gain.
