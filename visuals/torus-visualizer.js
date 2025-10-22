const THREE = window.THREE;

if (!THREE) {
  throw new Error('Three.js is required for the torus visualizer');
}

const TORUS_MAJOR_RADIUS = 1.0;
const TORUS_MINOR_RADIUS = 0.3;

const DATA_FILES = {
  notes: 'notes.json',
  chords: 'chords.json',
};

const HARDCODED_DATA = {
  notes: {
    Mag3: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    Pha3: [0, -1.5707963267948966, Math.PI, 1.5707963267948966, 0, -1.5707963267948966, Math.PI, 1.5707963267948966, 0, -1.5707963267948966, Math.PI, 1.5707963267948966],
    Pha5: [0, -2.6179938779914944, 1.0471975511965976, -1.5707963267948966, 2.0943951023931957, -0.5235987755982988, Math.PI, 0.5235987755982989, -2.0943951023931957, 1.5707963267948966, -1.0471975511965979, 2.6179938779914944],
    Labels: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  },
  chords: {
    Mag3: new Array(24).fill(0.7453559924999299),
    Pha3: [
      0.4636476090008061, 1.1071487177940904, -1.1071487177940904, -0.4636476090008061,
      -2.677945044588987, -2.0344439357957027, 2.0344439357957027, 2.677945044588987,
      0.4636476090008061, 1.1071487177940904, -1.1071487177940904, -0.4636476090008061,
      -2.677945044588987, -2.0344439357957027, 2.0344439357957027, 2.677945044588987,
      0.4636476090008061, 1.1071487177940904, -1.1071487177940904, -0.4636476090008061,
      -2.677945044588987, -2.0344439357957027, 2.0344439357957027, 2.677945044588987,
    ],
    Pha5: [
      0.7853981633974483, -0.26179938779914946, -1.8325957145940461, -2.879793265790644,
      1.8325957145940461, 0.7853981633974483, -0.7853981633974483, -1.8325957145940461,
      2.879793265790644, 1.8325957145940461, 0.26179938779914946, -0.7853981633974483,
      -2.356194490192345, 2.879793265790644, 1.3089969389957472, 0.26179938779914946,
      -1.3089969389957472, -2.356194490192345, 2.356194490192345, 1.3089969389957472,
      -0.2617993877991494, -1.3089969389957472, -2.879793265790644, 2.356194490192345,
    ],
    Labels: [
      'CMajor', 'Cminor', 'C#Major', 'C#minor', 'DMajor', 'Dminor', 'D#Major', 'D#minor',
      'EMajor', 'Eminor', 'FMajor', 'Fminor', 'F#Major', 'F#minor', 'GMajor', 'Gminor',
      'G#Major', 'G#minor', 'AMajor', 'Aminor', 'A#Major', 'A#minor', 'BMajor', 'Bminor',
    ],
  },
};

function convertNoteLabel(label, format) {
  const conversionTables = {
    sharps: { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' },
    flats: { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' },
    mixed: {
      'C#': 'C#/Db', Db: 'C#/Db', 'D#': 'D#/Eb', Eb: 'D#/Eb',
      'F#': 'F#/Gb', Gb: 'F#/Gb', 'G#': 'G#/Ab', Ab: 'G#/Ab',
      'A#': 'A#/Bb', Bb: 'A#/Bb',
    },
  };

  if (!label.includes('#') && !label.includes('b')) {
    return label;
  }

  const baseNote = label.match(/^[A-G][#b]?/)?.[0];
  if (!baseNote) {
    return label;
  }

  const table = conversionTables[format];
  if (table && table[baseNote]) {
    return label.replace(baseNote, table[baseNote]);
  }

  return label;
}

function disposeObject(object) {
  object.traverse(child => {
    if (child.isMesh || child.isLine || child.isSprite) {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(mat => {
          if (mat.map) {
            mat.map.dispose();
          }
          mat.dispose?.();
        });
      }
    }
  });
}

function createDynamicLine(color) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(6); // 2 points
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  geometry.setDrawRange(0, 0);
  const material = new THREE.LineBasicMaterial({
    color,
    opacity: 0.7,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.visible = false;
  return line;
}

export class TorusVisualizer {
  constructor(options) {
    const {
      canvas,
      container,
      resetButton,
      fullscreenButton,
      showDataSelect,
      noteNameSelect,
      waypointSizeInput,
      trailLengthInput,
      waypointSizeDisplay,
      trailLengthDisplay,
    } = options;

    this.canvas = canvas;
    this.container = container;
    this.resetButton = resetButton;
    this.fullscreenButton = fullscreenButton;
    this.showDataSelect = showDataSelect;
    this.noteNameSelect = noteNameSelect;
    this.waypointSizeInput = waypointSizeInput;
    this.trailLengthInput = trailLengthInput;
    this.waypointSizeDisplay = waypointSizeDisplay ?? null;
    this.trailLengthDisplay = trailLengthDisplay ?? null;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.torusGroup = null;
    this.torusMesh = null;
    this.rotationMatrix = new THREE.Matrix4();

    this.jsonCache = new Map();
    this.staticObjects = [];

    this.audioSphere = null;
    this.audioTrailLine = null;
    this.audioTrailPositions = [];
    this.trailMaxLength = parseInt(trailLengthInput?.value ?? '0', 10) || 0;

    this.guideLines = {
      pha5: null,
      pha3: null,
    };

    this.isPointerDown = false;
    this.pointerPosition = { x: 0, y: 0 };

    this.dataSelection = showDataSelect?.value ?? 'notes';
    this.waypointSize = parseFloat(waypointSizeInput?.value ?? '0.05') || 0.05;

    this.initialized = false;
    this.currentLoadToken = 0;

    if (this.waypointSizeDisplay) {
      this.waypointSizeDisplay.textContent = this.waypointSize.toFixed(3);
    }
    if (this.trailLengthDisplay) {
      this.trailLengthDisplay.textContent = `${this.trailMaxLength}`;
    }

    this.handleResize = this.handleResize.bind(this);
    this.renderLoop = this.renderLoop.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleFullscreenChange = this.handleFullscreenChange.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  initialize() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      this.initialized = false;
      setTimeout(() => this.initialize(), 100);
      return;
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    this.camera.position.set(0, 0, 3);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);

    const size = Math.min(rect.width, rect.height);
    this.renderer.setSize(size, size);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;

    const ambientLight = new THREE.AmbientLight(0x404040, 0.8);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(2, 2, 5);
    this.scene.add(directionalLight);

    this.torusGroup = new THREE.Group();

    const torusGeometry = new THREE.TorusGeometry(TORUS_MAJOR_RADIUS, TORUS_MINOR_RADIUS, 16, 100);
    const torusMaterial = new THREE.MeshLambertMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
    });
    this.torusMesh = new THREE.Mesh(torusGeometry, torusMaterial);
    this.torusMesh.rotation.x = Math.PI / 2;
    this.torusGroup.add(this.torusMesh);

    this.scene.add(this.torusGroup);

    this.ensureTrailLine();
    this.ensureGuideLines();

    this.bindUiEvents();

    this.renderer.setAnimationLoop(this.renderLoop);

    this.handleResize();
    this.refreshStaticData();
  }

  bindUiEvents() {
    if (!this.canvas) {
      return;
    }

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);

    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });

    this.resetButton?.addEventListener('click', () => this.resetOrientation());
    this.fullscreenButton?.addEventListener('click', () => this.toggleFullscreen());

    window.addEventListener('resize', this.handleResize);
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    document.addEventListener('keydown', this.handleKeyDown);

    this.showDataSelect?.addEventListener('change', () => {
      this.dataSelection = this.showDataSelect.value;
      this.refreshStaticData();
    });

    this.noteNameSelect?.addEventListener('change', () => {
      this.refreshStaticData();
    });

    this.waypointSizeInput?.addEventListener('input', () => {
      this.waypointSize = parseFloat(this.waypointSizeInput.value) || this.waypointSize;
      if (this.waypointSizeDisplay) {
        this.waypointSizeDisplay.textContent = this.waypointSize.toFixed(3);
      }
      this.refreshStaticData();
    });

    this.trailLengthInput?.addEventListener('input', () => {
      const length = parseInt(this.trailLengthInput.value, 10) || 0;
      this.setTrailLength(length);
    });
  }

  renderLoop() {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  resetOrientation() {
    this.rotationMatrix.identity();
    this.torusGroup.setRotationFromMatrix(this.rotationMatrix);
  }

  handleWheel(event) {
    event.preventDefault();
    if (!this.camera) return;

    const zoomSpeed = 0.1;
    if (event.deltaY > 0) {
      this.camera.position.multiplyScalar(1 + zoomSpeed);
    } else {
      this.camera.position.multiplyScalar(1 - zoomSpeed);
    }

    const distance = this.camera.position.length();
    const minDistance = 2;
    const maxDistance = 20;
    if (distance < minDistance) {
      this.camera.position.normalize().multiplyScalar(minDistance);
    } else if (distance > maxDistance) {
      this.camera.position.normalize().multiplyScalar(maxDistance);
    }
  }

  onPointerDown(event) {
    this.isPointerDown = true;
    this.pointerPosition.x = event.clientX;
    this.pointerPosition.y = event.clientY;
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.isPointerDown) {
      return;
    }

    const deltaX = event.clientX - this.pointerPosition.x;
    const deltaY = event.clientY - this.pointerPosition.y;

    const rotationSpeed = 0.01;
    const rotY = new THREE.Matrix4().makeRotationY(deltaX * rotationSpeed);
    const rotX = new THREE.Matrix4().makeRotationX(deltaY * rotationSpeed);

    this.rotationMatrix.multiplyMatrices(rotY, this.rotationMatrix);
    this.rotationMatrix.multiplyMatrices(rotX, this.rotationMatrix);

    this.torusGroup.setRotationFromMatrix(this.rotationMatrix);

    this.pointerPosition.x = event.clientX;
    this.pointerPosition.y = event.clientY;
  }

  onPointerUp(event) {
    if (this.isPointerDown && event.pointerId != null) {
      this.canvas.releasePointerCapture?.(event.pointerId);
    }
    this.isPointerDown = false;
  }

  toggleFullscreen() {
    if (!this.container) {
      return;
    }

    if (document.fullscreenElement === this.container) {
      document.exitFullscreen();
      return;
    }

    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }

    const requestFullscreen = this.container.requestFullscreen?.bind(this.container);
    if (requestFullscreen) {
      requestFullscreen().catch(() => {
        this.enterMobileFullscreen();
      });
    } else {
      this.enterMobileFullscreen();
    }
  }

  enterMobileFullscreen() {
    if (!this.container) return;
    this.container.classList.add('mobile-fullscreen');
    document.body.style.overflow = 'hidden';
    this.fullscreenButton && (this.fullscreenButton.textContent = '⊞ Exit');
    setTimeout(() => this.handleResize(), 100);
  }

  exitMobileFullscreen() {
    if (!this.container) return;
    this.container.classList.remove('mobile-fullscreen');
    document.body.style.overflow = '';
    this.fullscreenButton && (this.fullscreenButton.textContent = '⛶ Full');
    setTimeout(() => this.handleResize(), 100);
  }

  handleFullscreenChange() {
    if (!this.container) return;
    if (document.fullscreenElement === this.container) {
      this.fullscreenButton && (this.fullscreenButton.textContent = '⊞ Exit');
      setTimeout(() => this.handleResize(), 100);
    } else if (!document.fullscreenElement) {
      this.exitMobileFullscreen();
    }
  }

  handleKeyDown(event) {
    if (event.key === 'Escape' && this.container?.classList.contains('mobile-fullscreen')) {
      this.exitMobileFullscreen();
    }
  }

  handleResize() {
    if (!this.renderer || !this.camera || !this.container) {
      return;
    }

    const rect = this.container.getBoundingClientRect();
    const inFullscreen = document.fullscreenElement === this.container || this.container.classList.contains('mobile-fullscreen');

    if (inFullscreen) {
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    } else {
      const size = Math.max(1, Math.min(rect.width, rect.height));
      this.camera.aspect = 1;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(size, size);
      this.canvas.style.width = `${size}px`;
      this.canvas.style.height = `${size}px`;
    }
  }

  toroidalToCartesian(pha5, pha3, mag3) {
    const tubeRadius = mag3 * TORUS_MINOR_RADIUS;
    const majorX = TORUS_MAJOR_RADIUS * Math.cos(pha5);
    const majorZ = TORUS_MAJOR_RADIUS * Math.sin(pha5);
    const x = majorX + tubeRadius * Math.cos(pha3) * Math.cos(pha5);
    const y = tubeRadius * Math.sin(pha3);
    const z = majorZ + tubeRadius * Math.cos(pha3) * Math.sin(pha5);
    return new THREE.Vector3(x, y, z);
  }

  async refreshStaticData() {
    this.clearStaticObjects();

    const token = ++this.currentLoadToken;
    const selection = this.dataSelection;

    const datasets = [];
    if (selection === 'notes' || selection === 'both') {
      datasets.push('notes');
    }
    if (selection === 'chords' || selection === 'both') {
      datasets.push('chords');
    }

    if (datasets.length === 0) {
      return;
    }

    for (const key of datasets) {
      const data = await this.loadDataset(key).catch(() => HARDCODED_DATA[key]);
      if (this.currentLoadToken !== token) {
        return;
      }
      if (data) {
        this.plotDataset(data);
      }
    }
  }

  async loadDataset(key) {
    if (this.jsonCache.has(key)) {
      return this.jsonCache.get(key);
    }

    const filename = DATA_FILES[key];
    if (!filename) {
      return HARDCODED_DATA[key];
    }

    try {
      const response = await fetch(`json/${filename}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      if (!text.trim()) {
        throw new Error('Empty response');
      }
      const data = JSON.parse(text);
      this.jsonCache.set(key, data);
      return data;
    } catch (error) {
      console.error(`Failed to load ${filename}:`, error);
      const fallback = HARDCODED_DATA[key];
      if (fallback) {
        this.jsonCache.set(key, fallback);
        return fallback;
      }
      throw error;
    }
  }

  plotDataset(data) {
    const { Mag3, Pha3, Pha5, Labels } = data;
    if (!Mag3 || !Pha3 || !Pha5 || !Labels) {
      console.error('Invalid torus dataset');
      return;
    }

    const format = this.noteNameSelect?.value ?? 'sharps';
    const count = Math.min(Mag3.length, Pha3.length, Pha5.length, Labels.length);

    for (let i = 0; i < count; i++) {
      const mag3 = Mag3[i];
      const pha3 = Pha3[i];
      const pha5 = Pha5[i];
      const label = convertNoteLabel(Labels[i], format);

      const position = this.toroidalToCartesian(pha5, pha3, mag3);

      const geometry = new THREE.TetrahedronGeometry(this.waypointSize);
      const hue = ((pha5 + Math.PI) / (2 * Math.PI)) * 360;
      const material = new THREE.MeshLambertMaterial({
        color: new THREE.Color(`hsl(${hue}, 70%, 60%)`),
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      this.torusGroup.add(mesh);
      this.staticObjects.push(mesh);

      const labelPosition = this.toroidalToCartesian(pha5, pha3, Math.min(mag3 + 0.3, 1.1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(64, label.length * 8);
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, canvas.width / 2, canvas.height / 2);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.position.copy(labelPosition);
      sprite.scale.set(0.25, 0.125, 1);
      this.torusGroup.add(sprite);
      this.staticObjects.push(sprite);
    }
  }

  clearStaticObjects() {
    for (const obj of this.staticObjects) {
      this.torusGroup.remove(obj);
      disposeObject(obj);
    }
    this.staticObjects.length = 0;
  }

  ensureTrailLine() {
    if (this.audioTrailLine) {
      return;
    }
    const geometry = new THREE.BufferGeometry();
    const capacity = Math.max(this.trailMaxLength, 2);
    const positions = new Float32Array(capacity * 3);
    const attribute = new THREE.BufferAttribute(positions, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      opacity: 0.75,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.audioTrailLine = new THREE.Line(geometry, material);
    this.audioTrailLine.frustumCulled = false;
    this.audioTrailLine.visible = false;
    this.torusGroup.add(this.audioTrailLine);
  }

  resetTrailLine() {
    if (this.audioTrailLine) {
      this.torusGroup.remove(this.audioTrailLine);
      this.audioTrailLine.geometry.dispose();
      this.audioTrailLine.material.dispose();
      this.audioTrailLine = null;
    }
    this.ensureTrailLine();
    this.refreshTrailGeometry();
  }

  ensureGuideLines() {
    if (!this.guideLines.pha5) {
      this.guideLines.pha5 = createDynamicLine(0xff4444);
      this.torusGroup.add(this.guideLines.pha5);
    }
    if (!this.guideLines.pha3) {
      this.guideLines.pha3 = createDynamicLine(0x44ff44);
      this.torusGroup.add(this.guideLines.pha3);
    }
  }

  updateGuideLines(pha5, spherePosition) {
    this.ensureGuideLines();
    const tubeCenter = this.toroidalToCartesian(pha5, 0, 0);

    const pha5Line = this.guideLines.pha5;
    const attr5 = pha5Line.geometry.getAttribute('position');
    attr5.setXYZ(0, 0, 0, 0);
    attr5.setXYZ(1, tubeCenter.x, tubeCenter.y, tubeCenter.z);
    attr5.needsUpdate = true;
    pha5Line.geometry.setDrawRange(0, 2);
    pha5Line.geometry.computeBoundingSphere();
    pha5Line.visible = true;

    const pha3Line = this.guideLines.pha3;
    const attr3 = pha3Line.geometry.getAttribute('position');
    attr3.setXYZ(0, tubeCenter.x, tubeCenter.y, tubeCenter.z);
    attr3.setXYZ(1, spherePosition.x, spherePosition.y, spherePosition.z);
    attr3.needsUpdate = true;
    pha3Line.geometry.setDrawRange(0, 2);
    pha3Line.geometry.computeBoundingSphere();
    pha3Line.visible = true;
  }

  clearGuideLines() {
    if (this.guideLines.pha5) {
      this.guideLines.pha5.visible = false;
    }
    if (this.guideLines.pha3) {
      this.guideLines.pha3.visible = false;
    }
  }

  ensureAudioSphere() {
    if (this.audioSphere) {
      return;
    }
    const geometry = new THREE.SphereGeometry(0.08, 16, 12);
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0x111111,
    });
    this.audioSphere = new THREE.Mesh(geometry, material);
    this.audioSphere.visible = false;
    this.torusGroup.add(this.audioSphere);
  }

  setTrailLength(length) {
    this.trailMaxLength = Math.max(0, length | 0);
    if (this.trailLengthInput) {
      this.trailLengthInput.value = `${this.trailMaxLength}`;
    }
    if (this.trailLengthDisplay) {
      this.trailLengthDisplay.textContent = `${this.trailMaxLength}`;
    }
    if (this.audioTrailPositions.length > this.trailMaxLength) {
      this.audioTrailPositions.splice(0, this.audioTrailPositions.length - this.trailMaxLength);
    }
    this.resetTrailLine();
  }

  addTrailPosition(position) {
    if (this.trailMaxLength === 0) {
      this.clearTrail();
      return;
    }
    this.audioTrailPositions.push(position.clone());
    if (this.audioTrailPositions.length > this.trailMaxLength) {
      this.audioTrailPositions.shift();
    }
    this.refreshTrailGeometry();
  }

  refreshTrailGeometry() {
    if (!this.audioTrailLine) {
      return;
    }
    const count = this.audioTrailPositions.length;
    if (count < 2) {
      this.audioTrailLine.visible = false;
      this.audioTrailLine.geometry.setDrawRange(0, 0);
      return;
    }

    const capacity = this.audioTrailLine.geometry.getAttribute('position').count;
    if (capacity < count) {
      this.resetTrailLine();
    }

    const attribute = this.audioTrailLine.geometry.getAttribute('position');
    for (let i = 0; i < count; i++) {
      const point = this.audioTrailPositions[i];
      attribute.setXYZ(i, point.x, point.y, point.z);
    }
    attribute.needsUpdate = true;
    this.audioTrailLine.geometry.setDrawRange(0, count);
    this.audioTrailLine.geometry.computeBoundingSphere();
    this.audioTrailLine.visible = true;
  }

  clearTrail() {
    this.audioTrailPositions.length = 0;
    if (this.audioTrailLine) {
      this.audioTrailLine.visible = false;
      this.audioTrailLine.geometry.setDrawRange(0, 0);
    }
  }

  updateFromAudio(dftResult, rms, minRmsThreshold = 0) {
    if (!this.torusGroup || !dftResult) {
      return;
    }

    if (rms < minRmsThreshold) {
      this.hideAudioState();
      return;
    }

    const pha5 = dftResult.phases?.[5];
    const pha3 = dftResult.phases?.[3];
    const mag3 = dftResult.amplitudes?.[3];

    if (typeof pha5 !== 'number' || typeof pha3 !== 'number' || typeof mag3 !== 'number') {
      return;
    }

    this.ensureAudioSphere();

    const position = this.toroidalToCartesian(pha5, pha3, mag3);
    this.audioSphere.position.copy(position);
    this.audioSphere.visible = true;

    const hue = ((pha5 + Math.PI) / (2 * Math.PI)) * 360;
    const color = new THREE.Color(`hsl(${hue}, 90%, 70%)`);
    this.audioSphere.material.color.copy(color);
    this.audioSphere.material.emissive.set(`hsl(${hue}, 30%, 20%)`);

    this.addTrailPosition(position);
    this.updateGuideLines(pha5, position);
  }

  hideAudioState() {
    if (this.audioSphere) {
      this.audioSphere.visible = false;
    }
    this.clearTrail();
    this.clearGuideLines();
  }
}
