# Interaction prototype

This folder is a standalone technology test for the next mobilePCD interface.

## Goals

- prove simultaneous two-finger interaction on mobile
- test an infinite relative left-side control
- test a circular XY/radar pad that remembers its last position
- test Web Audio parameter smoothing and touch-triggered sound
- test a transparent Three.js torus with points, lines and labels
- stop audio automatically when the page becomes hidden

## Run

Serve the repository over HTTP/HTTPS and open:

`/prototype/`

On GitHub Pages this should be available at:

`https://t-tatsuya-w.github.io/mobilePCD/prototype/`

## Notes

This prototype intentionally does **not** modify or depend on the existing main app. Once the interaction model feels right on a phone, the next step is to wire in the existing PCD/audio analysis modules.
