const THREE = window.THREE;

const state = {
  dialValue: 0,
  dialUnwrapped: 0,
  dialPointerId: null,
  dialLastY: 0,
  dialLastTime: 0,
  radar: { x: 0, y: 0, held: false, pointerId: null },
};

const dialZone = document.getElementById('dialZone');
const dialValueEl = document.getElementById('dialValue');

const radarPanel = document.querySelector('.radar-panel');
const radarPad = document.getElementById('radarPad');
const radarPoint = document.getElementById('radarPoint');
const phiValueEl = document.getElementById('phiValue');
const radiusValueEl = document.getElementById('radiusValue');

function updateDialUi() {
  dialValueEl.textContent = state.dialValue.toFixed(2) + 'π';
  document.getElementById('thetaMarker').style.top = ((1 - state.dialValue) * 50) + '%';
  // Show the same point at both ends near ±π, like a seam on a circular scale.
  const ghost = document.getElementById('thetaMarkerGhost');
  ghost.style.top = state.dialValue >= 0 ? '100%' : '0%';
  ghost.style.opacity = Math.abs(state.dialValue) > 0.9 ? '0.55' : '0';
}

function updateRadarUi() {
  const phi = Math.atan2(state.radar.y, state.radar.x) / Math.PI;
  const radius = Math.min(1, Math.hypot(state.radar.x, state.radar.y));
  phiValueEl.textContent = phi.toFixed(2) + 'π';
  radiusValueEl.textContent = radius.toFixed(2);
  radarPoint.classList.toggle('active', state.radar.held);

  const px = 50 + state.radar.x * 50;
  const py = 50 - state.radar.y * 50;
  radarPoint.style.left = px + '%';
  radarPoint.style.top = py + '%';

}

dialZone.addEventListener('pointerdown', (event) => {
  if (state.dialPointerId !== null) return;
  state.dialPointerId = event.pointerId;
  state.dialLastY = event.clientY;
  state.dialLastTime = event.timeStamp;
  dialZone.setPointerCapture(event.pointerId);
  updateDialUi();
});

dialZone.addEventListener('pointermove', (event) => {
  if (event.pointerId !== state.dialPointerId) return;
  const dy = event.clientY - state.dialLastY;
  const dt = Math.max(8, event.timeStamp - state.dialLastTime);
  state.dialLastY = event.clientY;
  state.dialLastTime = event.timeStamp;

  // A slow drag maps directly to the visible scale: one track height spans 2π.
  // Faster movement gains up to 2x distance, with no momentum after release.
  const speed = Math.abs(dy) / dt; // pixels per millisecond
  const t = Math.max(0, Math.min(1, (speed - 0.35) / 1.15));
  const acceleration = 1 + t * t * (3 - 2 * t);
  const trackHeight = Math.max(1, dialZone.querySelector('.dial-track').clientHeight);
  const delta = -dy * 2 / trackHeight * acceleration;
  moveTheta(delta);
});

function moveTheta(delta) {
  state.dialUnwrapped += delta;
  // One full revolution spans -π to +π, in either direction.
  state.dialValue = ((state.dialUnwrapped + 1) % 2 + 2) % 2 - 1;
  updateDialUi();
}

// Mouse wheel and trackpads can keep turning the same circular scale.
dialZone.addEventListener('wheel', (event) => {
  event.preventDefault();
  const height = Math.max(1, dialZone.querySelector('.dial-track').clientHeight);
  const pixels = event.deltaMode === 1 ? event.deltaY * 16 :
    event.deltaMode === 2 ? event.deltaY * height : event.deltaY;
  moveTheta(-pixels * 2 / height);
}, { passive: false });

function endDial(event) {
  if (event.pointerId !== state.dialPointerId) return;
  state.dialPointerId = null;
  updateDialUi();
}

dialZone.addEventListener('pointerup', endDial);
dialZone.addEventListener('pointercancel', endDial);
dialZone.addEventListener('lostpointercapture', (event) => {
  if (event.pointerId === state.dialPointerId) {
    state.dialPointerId = null;
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

const container = document.getElementById('threeContainer');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
camera.position.set(0, 0, 6.1);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
container.appendChild(renderer.domElement);

const tiltGroup = new THREE.Group();
scene.add(tiltGroup);
const group = new THREE.Group();
tiltGroup.add(group);
let tilt = 0.75;
let spin = 0;
let viewPointerId = null;
let lastViewX = 0;
let lastViewY = 0;

container.addEventListener('pointerdown', (event) => {
  if (viewPointerId !== null) return;
  viewPointerId = event.pointerId;
  lastViewX = event.clientX;
  lastViewY = event.clientY;
  container.setPointerCapture(event.pointerId);
});
container.addEventListener('pointermove', (event) => {
  if (event.pointerId !== viewPointerId) return;
  const scale = Math.max(1, container.clientWidth);
  spin += (event.clientX - lastViewX) / scale * Math.PI * 2;
  tilt += (event.clientY - lastViewY) / scale * Math.PI;
  lastViewX = event.clientX;
  lastViewY = event.clientY;
});
function endView(event) {
  if (event.pointerId === viewPointerId) viewPointerId = null;
}
container.addEventListener('pointerup', endView);
container.addEventListener('pointercancel', endView);
container.addEventListener('lostpointercapture', endView);

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

// Fit the circular pad to the radar card itself, rather than the viewport.
function resizeRadar() {
  const style = getComputedStyle(radarPanel);
  const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const gap = parseFloat(style.gap) || 0;
  const contentWidth = Math.max(0, radarPanel.clientWidth - paddingX);
  const contentHeight = Math.max(0, radarPanel.clientHeight - paddingY);
  const wide = radarPanel.clientWidth > radarPanel.clientHeight;
  radarPanel.classList.toggle('wide', wide);
  const headerHeight = radarPanel.querySelector('.radar-header').offsetHeight;
  const valuesHeight = radarPanel.querySelector('.polar-grid').offsetHeight;
  const fit = wide
    ? Math.min(contentWidth - Math.max(82, contentWidth * 0.28) - gap,
        contentHeight - headerHeight - gap)
    : Math.min(contentWidth, contentHeight - headerHeight - valuesHeight - 2 * gap);
  radarPanel.style.setProperty('--radar-fit', Math.max(0, fit) + 'px');
}
const radarResizeObserver = new ResizeObserver(resizeRadar);
radarResizeObserver.observe(radarPanel);
resizeRadar();

const resizeObserver = new ResizeObserver(resizeThree);
resizeObserver.observe(container);
resizeThree();

function animate() {
  tiltGroup.rotation.x = tilt;
  group.rotation.z = spin;
  tiltGroup.updateMatrixWorld(true);

  renderer.render(scene, camera);
  updateLabels();
  requestAnimationFrame(animate);
}

updateDialUi();
updateRadarUi();
requestAnimationFrame(animate);
