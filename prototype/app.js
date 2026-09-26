const THREE = window.THREE;

const state = {
  dialValue: 0,
  dialDelta: 0,
  dialPointerId: null,
  dialLastY: 0,
  radar: { x: 0, y: 0, held: false, pointerId: null },
};

const dialZone = document.getElementById('dialZone');
const dialValueEl = document.getElementById('dialValue');
const dialDeltaEl = document.getElementById('dialDelta');

const radarPad = document.getElementById('radarPad');
const radarPoint = document.getElementById('radarPoint');
const xValueEl = document.getElementById('xValue');
const yValueEl = document.getElementById('yValue');
const heldValueEl = document.getElementById('heldValue');

const audioToggle = document.getElementById('audioToggle');
const audioStatus = document.getElementById('audioStatus');

let audioContext = null;
let oscillator = null;
let gainNode = null;
let filterNode = null;
let audioEnabled = false;

function updateDialUi() {
  dialValueEl.textContent = state.dialValue.toFixed(3);
  dialDeltaEl.textContent = state.dialDelta.toFixed(3);
}

function updateRadarUi() {
  xValueEl.textContent = state.radar.x.toFixed(3);
  yValueEl.textContent = state.radar.y.toFixed(3);
  heldValueEl.textContent = state.radar.held ? 'yes' : 'no';
  radarPoint.classList.toggle('active', state.radar.held);

  const px = 50 + state.radar.x * 50;
  const py = 50 - state.radar.y * 50;
  radarPoint.style.left = px + '%';
  radarPoint.style.top = py + '%';

  updateSynth();
}

dialZone.addEventListener('pointerdown', (event) => {
  if (state.dialPointerId !== null) return;
  state.dialPointerId = event.pointerId;
  state.dialLastY = event.clientY;
  state.dialDelta = 0;
  dialZone.setPointerCapture(event.pointerId);
  updateDialUi();
});

dialZone.addEventListener('pointermove', (event) => {
  if (event.pointerId !== state.dialPointerId) return;
  const dy = event.clientY - state.dialLastY;
  state.dialLastY = event.clientY;

  // Up increases value. Scale by viewport height so the interaction feels similar across phones.
  const scale = Math.max(220, window.innerHeight) * 0.55;
  const delta = -dy / scale;
  state.dialDelta = delta;
  state.dialValue += delta;
  updateDialUi();
  updateSynth();
});

function endDial(event) {
  if (event.pointerId !== state.dialPointerId) return;
  state.dialPointerId = null;
  state.dialDelta = 0;
  updateDialUi();
}

dialZone.addEventListener('pointerup', endDial);
dialZone.addEventListener('pointercancel', endDial);
dialZone.addEventListener('lostpointercapture', (event) => {
  if (event.pointerId === state.dialPointerId) {
    state.dialPointerId = null;
    state.dialDelta = 0;
    updateDialUi();
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

radarPad.addEventListener('pointerdown', async (event) => {
  if (state.radar.pointerId !== null) return;
  state.radar.pointerId = event.pointerId;
  state.radar.held = true;
  radarPad.setPointerCapture(event.pointerId);
  setRadarFromEvent(event);
  await ensureAudioReady();
  updateRadarUi();
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

async function ensureAudioReady() {
  if (!audioEnabled) return;
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx({ latencyHint: 'interactive' });

    oscillator = audioContext.createOscillator();
    gainNode = audioContext.createGain();
    filterNode = audioContext.createBiquadFilter();

    oscillator.type = 'sine';
    filterNode.type = 'lowpass';
    filterNode.Q.value = 1.2;
    gainNode.gain.value = 0;

    oscillator.connect(filterNode).connect(gainNode).connect(audioContext.destination);
    oscillator.start();
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
}

function updateSynth() {
  if (!audioContext || !oscillator || !gainNode || !filterNode) return;

  const now = audioContext.currentTime;
  const xNorm = (state.radar.x + 1) / 2;
  const yNorm = (state.radar.y + 1) / 2;

  // 110-880 Hz across the X axis; dial adds a continuous transposition offset.
  const baseFrequency = 110 * Math.pow(8, xNorm);
  const transposition = Math.pow(2, state.dialValue);
  const frequency = Math.min(2400, Math.max(45, baseFrequency * transposition));
  const cutoff = 250 + yNorm * 6000;

  oscillator.frequency.cancelScheduledValues(now);
  oscillator.frequency.setTargetAtTime(frequency, now, 0.015);

  filterNode.frequency.cancelScheduledValues(now);
  filterNode.frequency.setTargetAtTime(cutoff, now, 0.02);

  const targetGain = state.radar.held && audioEnabled ? 0.13 : 0;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setTargetAtTime(targetGain, now, targetGain > 0 ? 0.02 : 0.06);
}

async function disableAudio() {
  audioEnabled = false;
  audioToggle.textContent = 'Enable audio';
  audioStatus.textContent = 'audio idle';
  updateSynth();

  if (audioContext && audioContext.state === 'running') {
    await audioContext.suspend();
  }
}

audioToggle.addEventListener('click', async () => {
  audioEnabled = !audioEnabled;
  if (audioEnabled) {
    audioToggle.textContent = 'Disable audio';
    audioStatus.textContent = 'audio ready';
    await ensureAudioReady();
    updateSynth();
  } else {
    await disableAudio();
  }
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    state.radar.held = false;
    state.radar.pointerId = null;
    updateRadarUi();
    await disableAudio();
  }
});

// ---------------- Three.js prototype scene ----------------

const container = document.getElementById('threeContainer');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
camera.position.set(0, 1.25, 5.2);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
container.appendChild(renderer.domElement);

const group = new THREE.Group();
scene.add(group);

const torus = new THREE.Mesh(
  new THREE.TorusGeometry(1.55, 0.68, 30, 90),
  new THREE.MeshBasicMaterial({
    color: 0x738cff,
    transparent: true,
    opacity: 0.12,
    wireframe: true,
    depthWrite: false,
  })
);
group.add(torus);

const pointMaterial = new THREE.MeshBasicMaterial({ color: 0xf4f7fb });
const pointGeometry = new THREE.SphereGeometry(0.07, 18, 14);

const testPoints = [
  { label: 'A', pos: new THREE.Vector3(1.58, 0.18, 0.04) },
  { label: 'C', pos: new THREE.Vector3(-0.55, 1.15, 0.70) },
  { label: 'E', pos: new THREE.Vector3(-1.15, -0.62, -0.52) },
  { label: 'G', pos: new THREE.Vector3(0.28, -1.20, 0.92) },
];

for (const item of testPoints) {
  const marker = new THREE.Mesh(pointGeometry, pointMaterial);
  marker.position.copy(item.pos);
  marker.userData.label = item.label;
  group.add(marker);
}

const lineGeometry = new THREE.BufferGeometry().setFromPoints([
  testPoints[0].pos, testPoints[1].pos,
  testPoints[1].pos, testPoints[2].pos,
  testPoints[2].pos, testPoints[3].pos,
  testPoints[3].pos, testPoints[0].pos,
]);
const lines = new THREE.LineSegments(
  lineGeometry,
  new THREE.LineBasicMaterial({ color: 0x9affc9, transparent: true, opacity: 0.55 })
);
group.add(lines);

const labelLayer = document.createElement('div');
labelLayer.className = 'label-layer';
Object.assign(labelLayer.style, {
  position: 'absolute',
  inset: '0',
  pointerEvents: 'none',
});
container.appendChild(labelLayer);

const labelEls = testPoints.map((item) => {
  const el = document.createElement('div');
  el.textContent = item.label;
  Object.assign(el.style, {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    padding: '2px 5px',
    borderRadius: '999px',
    background: 'rgba(17,19,24,0.78)',
    border: '1px solid rgba(244,247,251,0.25)',
    fontSize: '11px',
    color: '#f4f7fb',
    whiteSpace: 'nowrap',
  });
  labelLayer.appendChild(el);
  return el;
});

function resizeThree() {
  const rect = container.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function updateLabels() {
  const rect = container.getBoundingClientRect();
  testPoints.forEach((item, index) => {
    const world = item.pos.clone();
    group.localToWorld(world);
    world.project(camera);
    const x = (world.x * 0.5 + 0.5) * rect.width;
    const y = (-world.y * 0.5 + 0.5) * rect.height;
    labelEls[index].style.left = x + 'px';
    labelEls[index].style.top = y + 'px';
    labelEls[index].style.opacity = world.z > 1 ? '0.35' : '1';
  });
}

const resizeObserver = new ResizeObserver(resizeThree);
resizeObserver.observe(container);
resizeThree();

let previous = performance.now();
function animate(now) {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;

  // Keep the prototype visually alive without stealing touch input from the controls.
  group.rotation.y += dt * 0.18;
  group.rotation.x = 0.18 + state.radar.y * 0.12;
  group.rotation.z = state.radar.x * 0.10;

  renderer.render(scene, camera);
  updateLabels();
  requestAnimationFrame(animate);
}

updateDialUi();
updateRadarUi();
requestAnimationFrame(animate);
