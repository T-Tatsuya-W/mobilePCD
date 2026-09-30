# Mobile PCD prototype

Open [the prototype](https://t-tatsuya-w.github.io/mobilePCD/prototype/) or serve the repository from its root with `python -m http.server` and visit `/prototype/`.

The prototype keeps its application code, audio processing, note/chord data, styles, manifest, and icons inside this directory. It does not import files from the parent application. The sole runtime dependency outside this folder is Three.js r128 from cdnjs, loaded in `index.html`. Serving it over HTTPS enables microphone access. The installable manifest launches `./` in standalone mode; it does not include offline caching.

## Controls

- The theta slider sets θ and loops across ±π. It defaults to circle-of-fifths note labels every π/6; use Theta slider settings for π labels or to choose any note as the root at θ = 0 and Φ = 0. The existing sharps/flats setting also changes slider labels.
- A mouse wheel anywhere outside the settings overlay changes θ in 48 exact positions (π/24 apart). Touch and mouse dragging stay continuous with a fixed gain set by Theta drag sensitivity; flick speed does not increase travel. The settings overlay scrolls normally.
- The main panel radar controls Φ and r. The pointer PCD and optional sine-wave audio follow the relative controls; root changes rebase the displayed torus/radar and map the pointer back to the correct absolute pitches.
- Drag the torus window to spin or tilt the view. Automatic spin has speed, range, and direction controls. Speed 0 is stationary; range 0 has no automatic travel, finite ranges oscillate around the current view, and ∞ spins continuously.
- Notes, chords, and chord connections show by default. Node plots and labels, optional note connections, adjustable torus radii, radar range, and the PCD display have controls in settings.
- Audio is enabled by default, but Web Audio waits for the first radar press. It sounds while held; Note persist keeps audio sounding after release: with Pointer follows mic enabled it continuously retunes to the detected pointer position; otherwise it holds the last played PCD. The radial note threshold interpolates between 0.13 at r = 0 and 0.18 at r = 1 by default. Octave and output volume controls live in Torus to audio settings.
- Starting the microphone analyses only a bounded live audio window, updates the torus marker and mic PCD, and shows an input-level light. Stop mic or leave the page to release capture. The mic marker dims to grey at the last position when input stops. Enable Pointer follows mic to drive θ, Φ and r (and the shared red pointer) from detection, including after a root change. In this mode manual theta and radar selection are disabled; radar hold/release still controls audio, with Note persist continuing to play and retune to the live pointer after release. Silence or stopping capture keeps the last position. This adds no audio storage or extra capture pipeline.

## Local files

- `app.js`, `styles.css`, and `torus-coordinates.js` implement the UI and visualisation.
- `audio/` contains the microphone FFT/PCD pipeline and the separate polyphonic output synthesizer.
- `pcd-dft.js` and `json/` provide the local transformation code and note, chord, and connection data.
- `icon.svg`, `icon-192.png`, and `icon-512.png` share the torus, connections, and pointer artwork used by the page and installed app.

## Mic analysis settings

Settings groups collapse independently; opening one does not close another or change its values. Plot visibility and connections are grouped with torus geometry, separate from view rotation. Mic controls and Mic analysis have separate headings.

Analysis window is adjustable in powers of two from 1024 to 32768 samples (default 8192). Larger windows improve FFT frequency resolution at the cost of temporal response. Analysis hop is adjustable from 128 samples up to the current window size (default 2048); smaller hops increase update frequency and CPU work. The controls display durations using the active microphone sample rate (48 kHz estimate before capture starts). A window change replaces and resets the bounded analysis buffers without restarting capture; no audio history accumulates. The other available analysis parameters—input level, pitch bin threshold, contrast, smoothing, frequency limits and reference A4—remain adjustable. Torus visual updates remain capped at 20 Hz.
