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
const plotModeInput = document.getElementById('plotMode');
const accidentalModeInput = document.getElementById('accidentalMode');
const torusSize = { major: TORUS_MAJOR_RADIUS, minor: TORUS_MINOR_RADIUS };

function updateThetaSlider() {
  thetaValueEl.textContent = state.thetaValue.toFixed(2) + 'π';
  document.getElementById('thetaMarker').style.top = ((1 - state.thetaValue) * 50) + '%';
  // Show the same point at both ends near ±π, like a seam on a circular scale.
  const ghost = document.getElementById('thetaMarkerGhost');
  ghost.style.top = state.thetaValue >= 0 ? '100%' : '0%';
  ghost.style.opacity = Math.abs(state.thetaValue) > 0.9 ? '0.55' : '0';
  updatePointer();
  updateThetaSlice();
}

function updateRadarUi() {
  const phi = Math.atan2(state.radar.y, state.radar.x) / Math.PI;
  const radius = Math.min(1, Math.hypot(state.radar.x, state.radar.y));
  phiValueEl.textContent = phi.toFixed(2) + 'π';
  radiusValueEl.textContent = radius.toFixed(2);
  radarPoint.classList.toggle('active', state.radar.held);
  radarPad.classList.toggle('active', state.radar.held);
  updatePointer();

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

const pointGeometry = new THREE.SphereGeometry(0.09, 18, 14);
const plottedPoints = [];

const labelLayer = document.createElement('div');
labelLayer.className = 'label-layer';
Object.assign(labelLayer.style, {
  position: 'absolute',
  inset: '0',
  pointerEvents: 'none',
});
torusWindow.appendChild(labelLayer);

function applyPlotMode() {
  for (const point of plottedPoints) {
    const visible = plotModeInput.value === 'both' || plotModeInput.value === point.kind;
    point.marker.visible = visible;
    point.labelEl.hidden = !visible;
  }
}
plotModeInput.addEventListener('change', applyPlotMode);

function applyAccidentalMode() {
  for (const point of plottedPoints) {
    point.labelEl.textContent = accidentalModeInput.value === 'flats' ? point.flatLabel : point.sharpLabel;
  }
}
accidentalModeInput.addEventListener('change', applyAccidentalMode);

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
      const theta = Pha5[index];
      const phi = Pha3[index];
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
      plottedPoints.push({ kind, pos, marker, labelEl, sharpLabel: label, flatLabel: LabelsFlat[index], theta, phi, r });
    });
  }
  applyPlotMode();
  applyAccidentalMode();
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
