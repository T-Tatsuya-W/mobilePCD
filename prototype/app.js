import { AudioProcessor } from './audio/processor.js';
import { TorusAudioOutput } from './audio/torus-output.js';
import { pcdToFrequencyDomain } from './pcd-dft.js';
import { TORUS_MAJOR_RADIUS, TORUS_MINOR_RADIUS, toroidalToCartesian } from './torus-coordinates.js?v=torus-settings-1';
const THREE = window.THREE;

const state = {
  thetaValue: 0,
  thetaUnwrapped: 0,
  thetaPointerId: null,
  thetaLastY: 0,
  thetaLastTime: 0,
  radar: { x: 0, y: 0, held: false, pointerId: null },
};

const thetaSliderPanel = document.getElementById('thetaSliderPanel');
const thetaValueEl = document.getElementById('thetaValue');

const mainPanel = document.querySelector('.main-panel');
const radarPad = document.getElementById('radarPad');
const radarPoint = document.getElementById('radarPoint');
const phiValueEl = document.getElementById('phiValue');
const radiusValueEl = document.getElementById('radiusValue');
const settingsToggle = document.getElementById('settingsToggle');
const torusSettings = document.getElementById('torusSettings');
const majorRadiusInput = document.getElementById('majorRadius');
const minorRadiusInput = document.getElementById('minorRadius');
const majorRadiusValue = document.getElementById('majorRadiusValue');
const minorRadiusValue = document.getElementById('minorRadiusValue');
const plotInputs = {
  notes: document.getElementById('plotNotes'),
  chords: document.getElementById('plotChords'),
};
const accidentalModeButton = document.getElementById('accidentalMode');
let useFlats = false;
const radarRangeInput = document.getElementById('radarRange');
const radarRangeValue = document.getElementById('radarRangeValue');
const thetaMarker = document.getElementById('thetaMarker');
const thetaMarkerGhost = document.getElementById('thetaMarkerGhost');
const torusSize = { major: TORUS_MAJOR_RADIUS, minor: TORUS_MINOR_RADIUS };
const micToggle = document.getElementById('micToggle');
const micStatus = document.getElementById('micStatus');
const micIndicator = document.getElementById('micIndicator');
const pcdSourceToggle = document.getElementById('pcdSourceToggle');
const pcdStrip = document.getElementById('pcdStrip');
const showPcdInput = document.getElementById('showPcd');
const pcdBars = document.getElementById('pcdBars');
const latestMicPcd = new Float32Array(12);
const pcdBarEls = [];
const pcdNameEls = [];
const pointerPcd = new Float32Array(12);
const audioOutput = new TorusAudioOutput();
const audioToggle = document.getElementById('audioToggle');
const audioStatus = document.getElementById('audioStatus');
const noteThresholdMinInput = document.getElementById('noteThresholdMin');
const noteThresholdMaxInput = document.getElementById('noteThresholdMax');
const noteThresholdMinValue = document.getElementById('noteThresholdMinValue');
const noteThresholdMaxValue = document.getElementById('noteThresholdMaxValue');
const noteThresholdValue = document.getElementById('noteThresholdValue');
let currentNoteThreshold = Number(noteThresholdMinInput.value);
const outputVolumeInput = document.getElementById('outputVolume');
const outputVolumeValue = document.getElementById('outputVolumeValue');
const octaveInputs = Array.from(document.querySelectorAll('.audio-octave'));
let audioPending = false;
let audioEnabled = true;
let showPointerPcd = true;
const sharpPcdNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const flatPcdNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

const rootNoteValue = document.getElementById('rootNoteValue');
const rootNoteButtons = document.getElementById('rootNoteButtons');
const rootButtons = [];
let rootPitchClass = 0;
let rootThetaOffset = 0;
let rootPhiOffset = 0;
const fullTurn = Math.PI * 2;
function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
function displayAngles(theta, phi) {
  return { theta: wrapAngle(theta - rootThetaOffset), phi: wrapAngle(phi - rootPhiOffset) };
}
for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'root-note-button';
  button.dataset.pitchClass = String(pitchClass);
  button.addEventListener('click', () => setTorusRoot(pitchClass));
  rootNoteButtons.appendChild(button);
  rootButtons.push(button);
}
function updateRootNames() {
  const names = useFlats ? flatPcdNames : sharpPcdNames;
  rootNoteValue.textContent = names[rootPitchClass];
  rootButtons.forEach((button, pitchClass) => {
    button.textContent = names[pitchClass];
    button.setAttribute('aria-label', names[pitchClass] + ' as torus root');
    button.setAttribute('aria-pressed', String(pitchClass === rootPitchClass));
  });
}
updateRootNames();


const thetaTrack = thetaSliderPanel.querySelector('.theta-slider-track');
const thetaLabelModeButton = document.getElementById('thetaLabelMode');
let showThetaNotes = true;
const thetaTickLabels = [];
// The phase-5 circle advances one perfect fifth per π/6: C, G, D ... F♯.
const thetaFractions = ['0', 'π/6', 'π/3', 'π/2', '2π/3', '5π/6', 'π'];
for (let step = 6; step >= -6; step--) {
  const tick = document.createElement('div');
  tick.className = 'theta-tick';
  tick.style.top = ((6 - step) / 12 * 100) + '%';
  const label = document.createElement('span');
  tick.appendChild(label);
  thetaTrack.insertBefore(tick, thetaMarker);
  thetaTickLabels.push({ step, label });
}
function updateThetaTickLabels() {
  const names = useFlats ? flatPcdNames : sharpPcdNames;
  for (const { step, label } of thetaTickLabels) {
    const pitchClass = ((rootPitchClass + step * 7) % 12 + 12) % 12;
    label.textContent = showThetaNotes ? names[pitchClass] :
      step === 0 ? '0' : (step > 0 ? '+' : '−') + thetaFractions[Math.abs(step)];
  }
}
thetaLabelModeButton.addEventListener('click', () => {
  showThetaNotes = !showThetaNotes;
  thetaLabelModeButton.textContent = showThetaNotes ? 'Circle of fifths' : 'π fractions';
  thetaLabelModeButton.setAttribute('aria-pressed', String(showThetaNotes));
  updateThetaTickLabels();
});
updateThetaTickLabels();


for (let i = 0; i < 12; i++) {
  const column = document.createElement('div');
  column.className = 'pcd-column';
  const bar = document.createElement('div');
  bar.className = 'pcd-bar';
  const fill = document.createElement('div');
  fill.className = 'pcd-bar-fill';
  bar.appendChild(fill);
  const name = document.createElement('span');
  name.textContent = sharpPcdNames[i];
  column.append(bar, name);
  pcdBars.appendChild(column);
  pcdBarEls.push(fill);
  pcdNameEls.push(name);
}
function drawPcd(values) {
  let peak = 0;
  for (let i = 0; i < 12; i++) peak = Math.max(peak, values[i] || 0);
  for (let i = 0; i < 12; i++) {
    const value = Math.max(0, Math.min(1, values[i] || 0));
    // Normalise bar height to the strongest bin so spread-out audio remains legible.
    pcdBarEls[i].style.height = peak > 0 ? (value / peak * 100).toFixed(1) + '%' : '0%';
    const aboveThreshold = showPointerPcd && value >= currentNoteThreshold && value > 0;
    pcdBarEls[i].parentElement.parentElement.classList.toggle('active-note', aboveThreshold);
    pcdBarEls[i].parentElement.title = pcdNameEls[i].textContent + ': ' + value.toFixed(3) +
      (aboveThreshold ? ' · above note threshold' : '');
  }
}
function updatePointerPcd() {
  const theta = state.thetaValue * Math.PI + rootThetaOffset;
  const phi = Math.atan2(state.radar.y, state.radar.x) + rootPhiOffset;
  const radius = Math.min(1, Math.hypot(state.radar.x, state.radar.y));
  let sum = 0;
  // Inverse real DFT for DC=1, bin 3 magnitude=r, bin 5 magnitude=1.
  // Reuse the same 12-value buffer for the display and sustained audio voices.
  for (let i = 0; i < 12; i++) {
    const value = (1 + 2 * radius * Math.cos(2 * Math.PI * 3 * i / 12 + phi) +
      2 * Math.cos(2 * Math.PI * 5 * i / 12 + theta)) / 12;
    pointerPcd[i] = Math.max(0, value);
    sum += pointerPcd[i];
  }
  if (sum > 0) for (let i = 0; i < 12; i++) pointerPcd[i] /= sum;
  audioOutput.update(pointerPcd);
  if (showPointerPcd && showPcdInput.checked) drawPcd(pointerPcd);
}
function updateNoteThreshold() {
  const min = Number(noteThresholdMinInput.value);
  const max = Number(noteThresholdMaxInput.value);
  const radius = Math.min(1, Math.hypot(state.radar.x, state.radar.y));
  currentNoteThreshold = min + (max - min) * radius;
  audioOutput.setThreshold(currentNoteThreshold);
  noteThresholdMinValue.textContent = min.toFixed(2);
  noteThresholdMaxValue.textContent = max.toFixed(2);
  noteThresholdValue.textContent = currentNoteThreshold.toFixed(2);
}
function updateAudioSettings() {
  updateNoteThreshold();
  audioOutput.setVolume(Number(outputVolumeInput.value));
  audioOutput.setOctaves(octaveInputs.filter(input => input.checked).map(input => Number(input.value)));
  if (showPointerPcd && showPcdInput.checked) drawPcd(pointerPcd);
  outputVolumeValue.textContent = Math.round(Number(outputVolumeInput.value) * 100) + '%';
}
noteThresholdMinInput.addEventListener('input', () => {
  // The threshold at the centre must never exceed the threshold at the edge.
  if (Number(noteThresholdMinInput.value) > Number(noteThresholdMaxInput.value)) {
    noteThresholdMaxInput.value = noteThresholdMinInput.value;
  }
  updateAudioSettings();
});
noteThresholdMaxInput.addEventListener('input', () => {
  if (Number(noteThresholdMaxInput.value) < Number(noteThresholdMinInput.value)) {
    noteThresholdMinInput.value = noteThresholdMaxInput.value;
  }
  updateAudioSettings();
});
outputVolumeInput.addEventListener('input', updateAudioSettings);
octaveInputs.forEach(input => input.addEventListener('change', updateAudioSettings));
updateAudioSettings();

// Audio is enabled by default, but browsers require a user gesture before Web Audio starts.
// The first radar press unlocks output and also begins playing that press's pointer PCD.
async function startAudio() {
  if (!audioEnabled || audioPending || audioOutput.isRunning()) return;
  if (!octaveInputs.some(input => input.checked)) {
    audioStatus.textContent = 'Select at least one octave';
    return;
  }
  audioPending = true;
  audioToggle.disabled = true;
  try {
    await audioOutput.start();
    audioOutput.update(pointerPcd);
    audioOutput.setHeld(state.radar.held);
    audioStatus.textContent = state.radar.held ? 'Playing pointer PCD' : 'Ready · hold radar to play';
  } catch (error) {
    await audioOutput.stop();
    audioStatus.textContent = 'Audio unavailable: ' + (error.name || 'error');
  } finally {
    audioPending = false;
    audioToggle.disabled = false;
  }
}

audioToggle.addEventListener('click', async () => {
  if (audioPending) return;
  audioEnabled = !audioEnabled;
  audioToggle.textContent = audioEnabled ? 'Stop audio' : 'Start audio';
  audioToggle.setAttribute('aria-pressed', String(audioEnabled));
  if (audioEnabled) {
    await startAudio();
  } else {
    audioStatus.textContent = 'Audio off';
    audioPending = true;
    audioToggle.disabled = true;
    try {
      await audioOutput.stop();
    } finally {
      audioPending = false;
      audioToggle.disabled = false;
    }
  }
});
pcdSourceToggle.addEventListener('click', () => {
  showPointerPcd = !showPointerPcd;
  pcdSourceToggle.textContent = showPointerPcd ? 'Pointer PCD' : 'Mic PCD';
  pcdSourceToggle.setAttribute('aria-pressed', String(showPointerPcd));
  pcdStrip.classList.toggle('mic-source', !showPointerPcd);
  pcdStrip.setAttribute('aria-label', showPointerPcd ? 'Pointer pitch class distribution' : 'Microphone pitch class distribution');
  if (showPointerPcd) updatePointerPcd();
  else if (showPcdInput.checked) drawPcd(latestMicPcd);
});
showPcdInput.addEventListener('change', () => {
  pcdStrip.hidden = !showPcdInput.checked;
  pcdStrip.parentElement.classList.toggle('pcd-hidden', pcdStrip.hidden);
  if (!pcdStrip.hidden) {
    if (showPointerPcd) updatePointerPcd();
    else drawPcd(latestMicPcd);
  }
});
updatePointerPcd();
const micSensitivityInput = document.getElementById('micSensitivity');
const micSensitivityValue = document.getElementById('micSensitivityValue');
const pcdControls = {
  pcdMinRms: document.getElementById('pcdMinRms'),
  pcdThreshold: document.getElementById('pcdThreshold'),
  pcdNormalize: document.getElementById('pcdNormalize'),
  smoothing: document.getElementById('pcdSmoothing'),
  minHz: document.getElementById('pcdMinHz'),
  maxHz: document.getElementById('pcdMaxHz'),
  refA4: document.getElementById('pcdRefA4'),
};
micSensitivityInput.addEventListener('input', () => {
  micSensitivityValue.textContent = Number(micSensitivityInput.value).toFixed(1) + '×';
});

function updateThetaSlider() {
  thetaValueEl.textContent = state.thetaValue.toFixed(2) + 'π';
  thetaMarker.style.top = ((1 - state.thetaValue) * 50) + '%';
  const hue = ((state.thetaValue + 1) * 180 + 360) % 360;
  thetaSliderPanel.style.setProperty('--theta-hue', hue);
  // Show the same point at both ends near ±π, like a seam on a circular scale.
  const ghost = thetaMarkerGhost;
  ghost.style.top = state.thetaValue >= 0 ? '100%' : '0%';
  ghost.style.opacity = Math.abs(state.thetaValue) > 0.9 ? '0.55' : '0';
  updatePointer();
  updateThetaSlice();
  updateRadarNodes();
  updatePointerPcd();
}

function updateRadarUi() {
  const phi = Math.atan2(state.radar.y, state.radar.x) / Math.PI;
  const radius = Math.min(1, Math.hypot(state.radar.x, state.radar.y));
  phiValueEl.textContent = phi.toFixed(2) + 'π';
  radiusValueEl.textContent = radius.toFixed(2);
  radarPoint.classList.toggle('active', state.radar.held);
  radarPad.classList.toggle('active', state.radar.held);
  updatePointer();
  updateNoteThreshold();
  updatePointerPcd();
  audioOutput.setHeld(state.radar.held);
  if (audioOutput.isRunning()) audioStatus.textContent = state.radar.held
    ? 'Playing pointer PCD' : 'Ready · hold radar to play';

  const px = 50 + state.radar.x * 50;
  const py = 50 - state.radar.y * 50;
  radarPoint.style.left = px + '%';
  radarPoint.style.top = py + '%';

}

thetaSliderPanel.addEventListener('pointerdown', (event) => {
  if (state.thetaPointerId !== null) return;
  state.thetaPointerId = event.pointerId;
  state.thetaLastY = event.clientY;
  state.thetaLastTime = event.timeStamp;
  thetaSliderPanel.setPointerCapture(event.pointerId);
  updateThetaSlider();
});

thetaSliderPanel.addEventListener('pointermove', (event) => {
  if (event.pointerId !== state.thetaPointerId) return;
  const dy = event.clientY - state.thetaLastY;
  const dt = Math.max(8, event.timeStamp - state.thetaLastTime);
  state.thetaLastY = event.clientY;
  state.thetaLastTime = event.timeStamp;

  // A slow drag maps directly to the visible scale: one track height spans 2π.
  // Faster movement gains up to 2x distance, with no momentum after release.
  const speed = Math.abs(dy) / dt; // pixels per millisecond
  const t = Math.max(0, Math.min(1, (speed - 0.35) / 1.15));
  const acceleration = 1 + t * t * (3 - 2 * t);
  const trackHeight = Math.max(1, thetaSliderPanel.querySelector('.theta-slider-track').clientHeight);
  const delta = -dy * 2 / trackHeight * acceleration;
  moveTheta(delta);
});

function moveTheta(delta) {
  state.thetaUnwrapped += delta;
  // One full revolution spans -π to +π, in either direction.
  state.thetaValue = ((state.thetaUnwrapped + 1) % 2 + 2) % 2 - 1;
  updateThetaSlider();
}

// Mouse wheel and trackpads can keep turning the same circular scale.
thetaSliderPanel.addEventListener('wheel', (event) => {
  event.preventDefault();
  const height = Math.max(1, thetaSliderPanel.querySelector('.theta-slider-track').clientHeight);
  const pixels = event.deltaMode === 1 ? event.deltaY * 16 :
    event.deltaMode === 2 ? event.deltaY * height : event.deltaY;
  moveTheta(-pixels * 2 / height);
}, { passive: false });

function endThetaSwipe(event) {
  if (event.pointerId !== state.thetaPointerId) return;
  state.thetaPointerId = null;
  updateThetaSlider();
}

thetaSliderPanel.addEventListener('pointerup', endThetaSwipe);
thetaSliderPanel.addEventListener('pointercancel', endThetaSwipe);
thetaSliderPanel.addEventListener('lostpointercapture', (event) => {
  if (event.pointerId === state.thetaPointerId) {
    state.thetaPointerId = null;
    updateThetaSlider();
  }
});

function setRadarFromEvent(event) {
  const rect = radarPad.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = rect.width / 2;

  let x = (event.clientX - cx) / radius;
  let y = -(event.clientY - cy) / radius;

  const length = Math.hypot(x, y);
  if (length > 1) {
    x /= length;
    y /= length;
  }

  state.radar.x = x;
  state.radar.y = y;
  updateRadarUi();
}

radarPad.addEventListener('pointerdown', (event) => {
  if (state.radar.pointerId !== null) return;
  state.radar.pointerId = event.pointerId;
  state.radar.held = true;
  radarPad.setPointerCapture(event.pointerId);
  setRadarFromEvent(event);
  updateRadarUi();
  void startAudio();
});

radarPad.addEventListener('pointermove', (event) => {
  if (event.pointerId !== state.radar.pointerId) return;
  setRadarFromEvent(event);
});

function endRadar(event) {
  if (event.pointerId !== state.radar.pointerId) return;
  state.radar.pointerId = null;
  state.radar.held = false;
  updateRadarUi();
}

radarPad.addEventListener('pointerup', endRadar);
radarPad.addEventListener('pointercancel', endRadar);
radarPad.addEventListener('lostpointercapture', (event) => {
  if (event.pointerId === state.radar.pointerId) {
    state.radar.pointerId = null;
    state.radar.held = false;
    updateRadarUi();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    state.radar.held = false;
    state.radar.pointerId = null;
    updateRadarUi();
  }
});

// One capture pipeline owns a fixed-size audio ring buffer and emits live PCD frames.
const audioProcessor = new AudioProcessor({
  windowSize: 8192,
  hopSize: 2048,
  tuner: { enabled: false },
});
let micPending = false;
let micPageHidden = false;
let lastPcdTime = -Infinity;
let liveCoordinates = null;
let micRms = 0;

for (const [key, input] of Object.entries(pcdControls)) {
  const output = document.getElementById(input.id + 'Value');
  const update = () => {
    const value = Number(input.value);
    output.textContent = key === 'pcdMinRms' ? value.toFixed(4) :
      key === 'pcdThreshold' ? value.toFixed(3) :
      key === 'smoothing' || key === 'pcdNormalize' ? value.toFixed(2) :
      String(value);
    audioProcessor.updateConfig({ [key]: value });
    // A silence threshold change should be reflected before another PCD frame.
    updateMicIndicator();
  };
  input.addEventListener('input', update);
  update();
}

function updateMicIndicator() {
  if (!audioProcessor.isRunning()) return;
  const level = Math.min(1, micRms * Number(micSensitivityInput.value));
  micIndicator.style.opacity = String(0.35 + level * 0.65);
  micIndicator.style.boxShadow = '0 0 ' + (3 + 17 * level) + 'px #ff3345';
}

function dimLiveMarker() {
  // Preserve the last valid position through silence and after mic capture stops.
  if (!liveCoordinates) return;
  liveMarker.material.color.setHex(0x9aa4b3);
  liveMarker.material.opacity = 0.45;
}

async function stopMic(message = 'Mic off') {
  dimLiveMarker();
  micRms = 0;
  latestMicPcd.fill(0);
  if (!showPointerPcd) {
    if (showPcdInput.checked) drawPcd(latestMicPcd);
  }
  await audioProcessor.stop();
  micIndicator.hidden = true;
  micIndicator.style.opacity = '0.35';
  micIndicator.style.boxShadow = '0 0 3px #ff3345';
  micToggle.textContent = 'Start mic';
  micToggle.setAttribute('aria-pressed', 'false');
  micStatus.textContent = message;
}

micToggle.addEventListener('click', async () => {
  if (micPending) return;
  micPending = true;
  micToggle.disabled = true;
  try {
    if (audioProcessor.isRunning()) {
      await stopMic();
    } else {
      micStatus.textContent = 'Requesting mic…';
      await audioProcessor.start();
      if (micPageHidden) {
        await stopMic();
        return;
      }
      await audioProcessor.audioContext.resume();
      audioProcessor.micStream.getAudioTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (audioProcessor.isRunning()) stopMic('Mic disconnected');
        }, { once: true });
      });
      lastPcdTime = -Infinity;
      micIndicator.hidden = false;
      micToggle.textContent = 'Stop mic';
      micToggle.setAttribute('aria-pressed', 'true');
      micStatus.textContent = 'Mic active · analysing…';
    }
  } catch (error) {
    await stopMic('Mic unavailable: ' + (error.name || 'access denied'));
  } finally {
    micPending = false;
    micToggle.disabled = false;
  }
});

audioProcessor.addEventListener('analysis', ({ detail: { pcd, rms, audioTime } }) => {
  micRms = rms;
  updateMicIndicator();
  if (micStatus.textContent.includes('analysing')) micStatus.textContent = 'Mic active';
  if (audioTime !== null && audioTime - lastPcdTime >= 0.05) {
    latestMicPcd.set(pcd);
    if (!showPointerPcd && showPcdInput.checked) drawPcd(latestMicPcd);
    const peak = Math.max(...latestMicPcd);
    micStatus.textContent = rms < audioProcessor.config.pcdMinRms
      ? 'Mic active · below input level'
      : peak < 0.0001 ? 'Mic active · no pitch bins' : 'Mic active';
  }
  if (rms < audioProcessor.config.pcdMinRms || audioTime === null) {
    dimLiveMarker();
    return;
  }
  // Process at most 20 visual updates per second; keep only the latest PCD.
  if (audioTime - lastPcdTime < 0.05) return;
  lastPcdTime = audioTime;
  const { amplitudes, phases } = pcdToFrequencyDomain(Array.from(pcd));
  if (amplitudes[5] < 0.00001) {
    dimLiveMarker();
    return;
  }
  liveCoordinates = { theta: phases[5], phi: phases[3], r: amplitudes[3] };
  updateLiveMarker();
  liveMarker.material.color.setHex(0xffffff);
  liveMarker.material.opacity = 1;
});
audioProcessor.addEventListener('error', ({ detail: error }) => {
  dimLiveMarker();
  micStatus.textContent = 'Analysis error: ' + (error?.message || 'unknown');
  console.error('Mic analysis failed:', error);
});
window.addEventListener('pagehide', () => {
  micPageHidden = true;
  stopMic();
  audioOutput.stop();
});

// ---------------- Three.js prototype scene ----------------

const torusWindow = document.getElementById('torusWindow');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
camera.position.set(0, 0, 6.1);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
torusWindow.appendChild(renderer.domElement);

const tiltGroup = new THREE.Group();
scene.add(tiltGroup);
const group = new THREE.Group();
tiltGroup.add(group);
let tilt = -0.85;
let spin = -Math.PI / 2;
let viewPointerId = null;
let lastViewX = 0;
let lastViewY = 0;

torusWindow.addEventListener('pointerdown', (event) => {
  if (viewPointerId !== null) return;
  viewPointerId = event.pointerId;
  lastViewX = event.clientX;
  lastViewY = event.clientY;
  torusWindow.setPointerCapture(event.pointerId);
});
torusWindow.addEventListener('pointermove', (event) => {
  if (event.pointerId !== viewPointerId) return;
  const scale = Math.max(1, torusWindow.clientWidth);
  spin += (event.clientX - lastViewX) / scale * Math.PI * 2;
  tilt += (event.clientY - lastViewY) / scale * Math.PI;
  lastViewX = event.clientX;
  lastViewY = event.clientY;
});
function endView(event) {
  if (event.pointerId === viewPointerId) viewPointerId = null;
}
torusWindow.addEventListener('pointerup', endView);
torusWindow.addEventListener('pointercancel', endView);
torusWindow.addEventListener('lostpointercapture', endView);

const torus = new THREE.Mesh(
  new THREE.TorusGeometry(torusSize.major, torusSize.minor, 30, 90),
  new THREE.MeshBasicMaterial({
    color: 0x738cff,
    transparent: true,
    opacity: 0.12,
    wireframe: true,
    depthWrite: false,
  })
);
group.add(torus);

// The red loop traces the outer surface of the tube at the current θ.
const SLICE_SEGMENTS = 96;
const slicePositions = new Float32Array(SLICE_SEGMENTS * 3);
const sliceGeometry = new THREE.BufferGeometry();
const sliceAttribute = new THREE.BufferAttribute(slicePositions, 3);
sliceAttribute.setUsage(THREE.DynamicDrawUsage);
sliceGeometry.setAttribute('position', sliceAttribute);
const thetaSlice = new THREE.LineLoop(
  sliceGeometry,
  new THREE.LineBasicMaterial({
    color: 0xff525e, transparent: true, opacity: 0.95,
    depthTest: false, depthWrite: false,
  })
);
thetaSlice.frustumCulled = false;
thetaSlice.renderOrder = 1;
group.add(thetaSlice);

function updateThetaSlice() {
  const theta = state.thetaValue * Math.PI;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  for (let i = 0; i < SLICE_SEGMENTS; i++) {
    const phi = 2 * Math.PI * i / SLICE_SEGMENTS;
    const radial = torusSize.major + torusSize.minor * Math.cos(phi);
    const offset = i * 3;
    slicePositions[offset] = radial * cosTheta;
    slicePositions[offset + 1] = radial * sinTheta;
    slicePositions[offset + 2] = torusSize.minor * Math.sin(phi);
  }
  sliceAttribute.needsUpdate = true;
}

// One persistent mesh follows θ, Φ and r; only its position and opacity change.
const pointerMaterial = new THREE.MeshBasicMaterial({
  color: 0xff525e, transparent: true, opacity: 0.55,
});
const pointer = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 16), pointerMaterial);
group.add(pointer);

function updatePointer() {
  const theta = state.thetaValue * Math.PI;
  const phi = Math.atan2(state.radar.y, state.radar.x);
  const r = Math.min(1, Math.hypot(state.radar.x, state.radar.y));
  toroidalToCartesian(theta, phi, r, pointer.position, torusSize.major, torusSize.minor);
  pointerMaterial.opacity = state.radar.held ? 1 : 0.55;
}

// A single marker follows the latest microphone PCD; radius edits reposition it.
const liveMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.14, 20, 16),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthTest: false })
);
liveMarker.renderOrder = 3;
liveMarker.visible = false;
group.add(liveMarker);
function updateLiveMarker() {
  if (!liveCoordinates) return;
  const angles = displayAngles(liveCoordinates.theta, liveCoordinates.phi);
  toroidalToCartesian(
    angles.theta, angles.phi, liveCoordinates.r,
    liveMarker.position, torusSize.major, torusSize.minor
  );
  liveMarker.visible = true;
}

const pointGeometry = new THREE.SphereGeometry(0.09, 18, 14);
const plottedPoints = [];
const radarNodes = document.createElement('div');
radarNodes.className = 'radar-nodes';
radarPad.insertBefore(radarNodes, radarPoint);

function updateRadarNodes() {
  const theta = state.thetaValue * Math.PI;
  const range = Number(radarRangeInput.value) * Math.PI;
  for (const point of plottedPoints) {
    const angularDistance = Math.abs(Math.atan2(Math.sin(point.theta - theta), Math.cos(point.theta - theta)));
    const visibleKind = plotInputs[point.kind].checked;
    const opacity = Math.max(0, 1 - angularDistance / range);
    point.radarEl.hidden = !visibleKind || opacity <= 0;
    if (!point.radarEl.hidden) point.radarEl.style.opacity = opacity.toFixed(3);
  }
}
radarRangeInput.addEventListener('input', () => {
  radarRangeValue.textContent = Number(radarRangeInput.value).toFixed(2) + 'π';
  updateRadarNodes();
});

const labelLayer = document.createElement('div');
labelLayer.className = 'label-layer';
Object.assign(labelLayer.style, {
  position: 'absolute',
  inset: '0',
  pointerEvents: 'none',
});
torusWindow.appendChild(labelLayer);

const connectionInputs = {
  notes: document.getElementById('noteConnections'),
  chords: document.getElementById('chordConnections'),
};
const connectionLines = {};

function updateConnectionVisibility() {
  for (const kind of ['notes', 'chords']) {
    if (connectionLines[kind]) {
      connectionLines[kind].visible =
        connectionInputs[kind].checked &&
        (plotInputs[kind].checked);
    }
  }
}
connectionInputs.notes.addEventListener('change', updateConnectionVisibility);
connectionInputs.chords.addEventListener('change', updateConnectionVisibility);

function updateConnectionPositions() {
  for (const kind of ['notes', 'chords']) {
    const line = connectionLines[kind];
    if (!line) continue;
    const positions = line.geometry.attributes.position;
    line.userData.edges.forEach(([from, to], index) => {
      const offset = index * 6;
      const start = line.userData.nodes[from].pos;
      const end = line.userData.nodes[to].pos;
      positions.array[offset] = start.x;
      positions.array[offset + 1] = start.y;
      positions.array[offset + 2] = start.z;
      positions.array[offset + 3] = end.x;
      positions.array[offset + 4] = end.y;
      positions.array[offset + 5] = end.z;
    });
    positions.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }
}

async function loadConnections() {
  const response = await fetch('./json/connections.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load connections.json: ' + response.status);
  const data = await response.json();
  for (const [kind, key, color] of [
    ['notes', 'IntervalConnections', 0x83cde6],
    ['chords', 'ChordConnections', 0xf0a67f],
  ]) {
    const nodes = plottedPoints.filter(point => point.kind === kind);
    const pairs = data[key];
    if (!Array.isArray(pairs) || !pairs.every(pair =>
      Array.isArray(pair) && pair.length === 2 &&
      pair.every(index => Number.isInteger(index) && index >= 0 && index < nodes.length)
    )) throw new Error('Invalid ' + key + ' indices');
    // The chord source includes each pair in both directions; render each edge once.
    const seen = new Set();
    const edges = pairs.filter(([from, to]) => {
      const key = [Math.min(from, to), Math.max(from, to)].join(':');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(new Float32Array(edges.length * 6), 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    line.userData = { nodes, edges };
    connectionLines[kind] = line;
    group.add(line);
  }
  updateConnectionPositions();
  updateConnectionVisibility();
  updateRadarNodes();
}

function applyPlotMode() {
  for (const point of plottedPoints) {
    const visible = plotInputs[point.kind].checked;
    point.marker.visible = visible;
    point.labelEl.hidden = !visible;
  }
  updateConnectionVisibility();
  updateRadarNodes();
}
plotInputs.notes.addEventListener('change', applyPlotMode);
plotInputs.chords.addEventListener('change', applyPlotMode);

function applyAccidentalMode() {
  updateThetaTickLabels();
  for (const point of plottedPoints) {
    const label = useFlats ? point.flatLabel : point.sharpLabel;
    point.labelEl.textContent = label;
    point.radarEl.textContent = label;
  }
  updateRootNames();
  pcdNameEls.forEach((el, index) => {
    el.textContent = (useFlats ? flatPcdNames : sharpPcdNames)[index];
  });
  if (showPointerPcd) updatePointerPcd();
  else drawPcd(latestMicPcd);
}
accidentalModeButton.addEventListener('click', () => {
  useFlats = !useFlats;
  accidentalModeButton.textContent = useFlats ? 'Flats (♭)' : 'Sharps (♯)';
  accidentalModeButton.setAttribute('aria-pressed', String(useFlats));
  applyAccidentalMode();
});

async function loadPlotPoints() {
  const datasets = await Promise.all(['notes', 'chords'].map(async kind => {
    const response = await fetch('./json/' + kind + '.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load ' + kind + '.json: ' + response.status);
    const data = await response.json();
    const expected = kind === 'notes' ? 12 : 24;
    if (![data.Mag3, data.Pha3, data.Pha5, data.Labels, data.LabelsFlat].every(
      values => Array.isArray(values) && values.length === expected
    )) throw new Error('Expected ' + expected + ' values in each ' + kind + '.json array');
    return { kind, data };
  }));

  for (const { kind, data: { Mag3, Pha3, Pha5, Labels, LabelsFlat } } of datasets) {
    Labels.forEach((label, index) => {
      const absoluteTheta = Pha5[index];
      const absolutePhi = Pha3[index];
      const { theta, phi } = displayAngles(absoluteTheta, absolutePhi);
      const r = Mag3[index];
      const point = toroidalToCartesian(theta, phi, r, {}, torusSize.major, torusSize.minor);
      const pos = new THREE.Vector3(point.x, point.y, point.z);
      // Match the original plot: phase 5 (θ) maps from −π…+π around the hue wheel.
      const hue = ((theta + Math.PI) / (2 * Math.PI) + 1) % 1;
      const color = new THREE.Color().setHSL(hue, 0.85, 0.6);
      const marker = new THREE.Mesh(pointGeometry, new THREE.MeshBasicMaterial({ color }));
      marker.position.copy(pos);
      group.add(marker);

      const labelEl = document.createElement('div');
      labelEl.className = 'torus-node-label';
      labelEl.textContent = label;
      labelLayer.appendChild(labelEl);
      const radarEl = document.createElement('span');
      radarEl.className = 'radar-node';
      radarEl.textContent = label;
      radarEl.style.left = (50 + 50 * r * Math.cos(phi)) + '%';
      radarEl.style.top = (50 - 50 * r * Math.sin(phi)) + '%';
      radarEl.style.backgroundColor = '#' + color.getHexString();
      radarEl.hidden = true;
      radarNodes.appendChild(radarEl);
      plottedPoints.push({ kind, pos, marker, labelEl, radarEl, sharpLabel: label, flatLabel: LabelsFlat[index], absoluteTheta, absolutePhi, theta, phi, r });
    });
  }
  applyPlotMode();
  applyAccidentalMode();
  await loadConnections();
}
// Rebase only the torus display. Absolute PCD angles still drive the same music maths.
function setTorusRoot(pitchClass) {
  if (pitchClass === rootPitchClass) return;
  rootPitchClass = pitchClass;
  // A semitone shifts DFT phases 5 and 3 by -5π/6 and -π/2 respectively.
  // One perfect fifth (G) therefore shifts θ by +π/6 and Φ by +π/2.
  rootThetaOffset = -fullTurn * 5 * pitchClass / 12;
  rootPhiOffset = -fullTurn * 3 * pitchClass / 12;
  updateRootNames();
  updateThetaTickLabels();
  for (const point of plottedPoints) {
    const angles = displayAngles(point.absoluteTheta, point.absolutePhi);
    point.theta = angles.theta;
    point.phi = angles.phi;
    toroidalToCartesian(point.theta, point.phi, point.r, point.pos, torusSize.major, torusSize.minor);
    point.marker.position.copy(point.pos);
    point.radarEl.style.left = (50 + 50 * point.r * Math.cos(point.phi)) + '%';
    point.radarEl.style.top = (50 - 50 * point.r * Math.sin(point.phi)) + '%';
    const hue = ((point.theta + Math.PI) / fullTurn + 1) % 1;
    point.marker.material.color.setHSL(hue, 0.85, 0.6);
    point.radarEl.style.backgroundColor = '#' + point.marker.material.color.getHexString();
  }
  updateConnectionPositions();
  updateRadarNodes();
  updateLiveMarker();
  updatePointerPcd();
}

// Settings change the geometry and the same polar positions used by every node.
let resizeQueued = false;
function applyTorusSize() {
  resizeQueued = false;
  const oldGeometry = torus.geometry;
  torus.geometry = new THREE.TorusGeometry(torusSize.major, torusSize.minor, 30, 90);
  oldGeometry.dispose();

  for (const note of plottedPoints) {
    toroidalToCartesian(
      note.theta, note.phi, note.r, note.pos, torusSize.major, torusSize.minor
    );
    note.marker.position.copy(note.pos);
  }
  updateThetaSlice();
  updatePointer();
  updateConnectionPositions();
  updateLiveMarker();

  // Keep the full torus in the square viewing window at larger sizes.
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  camera.position.z = Math.max(
    6.1,
    (torusSize.major + torusSize.minor) * 1.12 / Math.tan(halfFov) + torusSize.minor
  );
  camera.updateProjectionMatrix();
}

function queueTorusResize() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(applyTorusSize);
}

settingsToggle.addEventListener('click', () => {
  torusSettings.hidden = !torusSettings.hidden;
  settingsToggle.setAttribute('aria-expanded', String(!torusSettings.hidden));
  settingsToggle.classList.toggle('active', !torusSettings.hidden);
});

function updateTorusSettings() {
  torusSize.major = Number(majorRadiusInput.value);
  minorRadiusInput.max = Math.min(1, torusSize.major - 0.1).toFixed(2);
  torusSize.minor = Math.min(Number(minorRadiusInput.value), Number(minorRadiusInput.max));
  minorRadiusInput.value = String(torusSize.minor);
  majorRadiusValue.textContent = torusSize.major.toFixed(2);
  minorRadiusValue.textContent = torusSize.minor.toFixed(2);
  queueTorusResize();
}
majorRadiusInput.addEventListener('input', updateTorusSettings);
minorRadiusInput.addEventListener('input', updateTorusSettings);

loadPlotPoints().catch(error => {
  console.error('Node plotting failed:', error);
  const message = document.createElement('div');
  message.className = 'note-load-error';
  message.textContent = 'Nodes could not load. Reload this page.';
  torusWindow.appendChild(message);
});

function resizeThree() {
  const rect = torusWindow.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const projectedPoint = new THREE.Vector3();
function updateLabels() {
  const rect = torusWindow.getBoundingClientRect();
  plottedPoints.forEach(item => {
    if (!item.marker.visible) return;
    projectedPoint.copy(item.pos);
    group.localToWorld(projectedPoint);
    projectedPoint.project(camera);
    const x = (projectedPoint.x * 0.5 + 0.5) * rect.width;
    const y = (-projectedPoint.y * 0.5 + 0.5) * rect.height;
    item.labelEl.style.left = x + 'px';
    item.labelEl.style.top = y + 'px';
    item.labelEl.style.opacity = projectedPoint.z > 1 ? '0.35' : '1';
  });
}

// Fit the circular pad to the radar card itself, rather than the viewport.
function resizeMainPanel() {
  const style = getComputedStyle(mainPanel);
  const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const gap = parseFloat(style.gap) || 0;
  const contentWidth = Math.max(0, mainPanel.clientWidth - paddingX);
  const contentHeight = Math.max(0, mainPanel.clientHeight - paddingY);
  const wide = mainPanel.clientWidth > mainPanel.clientHeight;
  mainPanel.classList.toggle('wide', wide);
  const headerHeight = mainPanel.querySelector('.main-header').offsetHeight;
  const valuesHeight = mainPanel.querySelector('.main-values').offsetHeight;
  const fit = wide
    ? Math.min(contentWidth - Math.max(82, contentWidth * 0.28) - gap,
        contentHeight - headerHeight - gap)
    : Math.min(contentWidth, contentHeight - headerHeight - valuesHeight - 2 * gap);
  mainPanel.style.setProperty('--radar-fit', Math.max(0, fit) + 'px');
}
const mainPanelResizeObserver = new ResizeObserver(resizeMainPanel);
mainPanelResizeObserver.observe(mainPanel);
resizeMainPanel();

const resizeObserver = new ResizeObserver(resizeThree);
resizeObserver.observe(torusWindow);
resizeThree();

function animate() {
  tiltGroup.rotation.x = tilt;
  group.rotation.z = spin;
  tiltGroup.updateMatrixWorld(true);

  renderer.render(scene, camera);
  updateLabels();
  requestAnimationFrame(animate);
}

updateThetaSlider();
updateRadarUi();
requestAnimationFrame(animate);
