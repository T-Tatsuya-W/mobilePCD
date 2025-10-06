
import { pcdToFrequencyDomain } from './pcd-dft.js';
  
  // =========================
  // ====== CONFIG HERE ======
  // =========================
  let WINDOW_SIZE = 8192*2;   // larger window helps tuning stability
  let HOP_SIZE    = 1024;
  let MIN_HZ      = 50;
  let MAX_HZ      = 5000;
  let REF_A4      = 440;
  let SMOOTHING   = 0.6;
  
  // PCD filtering parameters
  let PCD_MIN_RMS = 0.001;      // minimum RMS for PCD calculation
  let PCD_THRESHOLD = 0.005;    // minimum magnitude to include in PCD
  let PCD_NORMALIZE = 1.0;      // power scaling for PCD normalization

  const RING = {
    innerRadiusRatio: 0.38,
    outerRadiusRatio: 0.95,
    labelRadiusRatio: 0.30,
    gapRadians: 0.02,          // visual gap between wedges
    baseRotation: -Math.PI/2,  // C at 12 o’clock
  };

  // Even-hue color palette (equal S/L; 30° steps)
  // Different note naming conventions
  const NOTE_LABELS = {
    sharps: ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],
    flats:  ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'],
    mixed:  ['C','C#/Db','D','D#/Eb','E','F','F#/Gb','G','G#/Ab','A','A#/Bb','B']
  };
  let currentNoteLabels = NOTE_LABELS.sharps; // default
  const IS_BLACK    = [false,true,false,true,false,false,true,false,true,false,true,false]; // C#,D,D#,E,F,F#,G,G#,A,A#,B,C
  const COLOR = { startHue: 0, sat: 80, light: 55 };
  const PC_HUE = i => (COLOR.startHue + i * 30) % 360;
  const SLOT_BG_ALPHA = 0.15;

  // Tuning needle defaults (some are user-adjustable below)
  const TUNER = {
    enabled: true,
    minHz: 70,
    maxHz: 1800,
    minProminence: 6.0,  // dB (slider)
    minRMS: 0.003,       // (slider)
    reactivity: 0.35,    // 0.05..1.0 (slider) — EMA step for angle smoothing
    needleColor: '#00aaff',
    needleWidth: 3,
    hubRadiusRatio: 0.05,
    tipRadiusRatio: 0.98,
    tailRadiusRatio: 0.20
  };
  // =========================

  // ===== Utilities =====
  // Cache window functions to avoid recomputation
  const windowCache = new Map();
  const hann = (N) => {
    if (windowCache.has(N)) return windowCache.get(N);
    const w = new Float32Array(N);
    const t = 2 * Math.PI / (N - 1);
    for (let n = 0; n < N; n++) w[n] = 0.5 * (1 - Math.cos(t * n));
    windowCache.set(N, w);
    return w;
  };

  // Pre-allocated buffers for FFT (reused to avoid GC pressure)
  let fftBufferRe, fftBufferIm, fftMags, bitRevTable;
  let currentFFTSize = 0;

  function initFFTBuffers(N){
    if (N === currentFFTSize) return; // Already initialized
    currentFFTSize = N;
    fftBufferRe = new Float32Array(N);
    fftBufferIm = new Float32Array(N);
    fftMags = new Float32Array(N/2);
    
    // Pre-compute bit-reversal table
    bitRevTable = new Uint32Array(N);
    let j = 0;
    for (let i = 1; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      bitRevTable[i] = j;
    }
  }

  function fftReal(signal){
    let N = 1; while (N < signal.length) N <<= 1;
    initFFTBuffers(N);
    
    // Clear and copy input
    fftBufferRe.fill(0);
    fftBufferIm.fill(0);
    fftBufferRe.set(signal);
    
    // Bit-reversal using pre-computed table
    for (let i = 1; i < N; i++) {
      const j = bitRevTable[i];
      if (i < j) {
        [fftBufferRe[i], fftBufferRe[j]] = [fftBufferRe[j], fftBufferRe[i]];
        [fftBufferIm[i], fftBufferIm[j]] = [fftBufferIm[j], fftBufferIm[i]];
      }
    }
    
    // FFT computation with pre-computed twiddle factors
    for (let len = 2; len <= N; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wlenRe = Math.cos(ang), wlenIm = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let wRe = 1, wIm = 0;
        const halfLen = len >> 1;
        for (let k = 0; k < halfLen; k++) {
          const uRe = fftBufferRe[i + k], uIm = fftBufferIm[i + k];
          const vRe = fftBufferRe[i + k + halfLen] * wRe - fftBufferIm[i + k + halfLen] * wIm;
          const vIm = fftBufferRe[i + k + halfLen] * wIm + fftBufferIm[i + k + halfLen] * wRe;
          fftBufferRe[i + k] = uRe + vRe;
          fftBufferIm[i + k] = uIm + vIm;
          fftBufferRe[i + k + halfLen] = uRe - vRe;
          fftBufferIm[i + k + halfLen] = uIm - vIm;
          const nwRe = wRe * wlenRe - wIm * wlenIm;
          const nwIm = wRe * wlenIm + wIm * wlenRe;
          wRe = nwRe; wIm = nwIm;
        }
      }
    }
    
    // Compute magnitudes (reuse buffer)
    const halfN = N >> 1;
    for (let i = 0; i < halfN; i++) {
      fftMags[i] = Math.sqrt(fftBufferRe[i] * fftBufferRe[i] + fftBufferIm[i] * fftBufferIm[i]);
    }
    return fftMags.subarray(0, halfN);
  }

  // Pre-computed lookup tables for PCD calculation
  let pcdLookupTable = null;
  let currentSampleRate = 0, currentA4 = 0, currentMagsLength = 0;

  function initPCDLookup(magsLength, sampleRate, a4) {
    if (sampleRate === currentSampleRate && a4 === currentA4 && magsLength === currentMagsLength) return;
    currentSampleRate = sampleRate;
    currentA4 = a4;
    currentMagsLength = magsLength;
    
    pcdLookupTable = new Uint8Array(magsLength); // pitch class for each bin
    const binHz = sampleRate / (magsLength * 2);
    const log2A4 = Math.log2(a4);
    
    for (let k = 0; k < magsLength; k++) {
      const f = k * binHz;
      if (f > 0) {
        const midi = 69 + 12 * (Math.log2(f) - log2A4);
        pcdLookupTable[k] = ((Math.round(midi) % 12) + 12) % 12;
      }
    }
  }

  function spectrumToPCD(mags, sampleRate, a4=440, minHz=50, maxHz=5000){
    initPCDLookup(mags.length, sampleRate, a4);
    
    const pcd = new Float32Array(12);
    const binHz = sampleRate / (mags.length * 2);
    const minBin = Math.max(1, Math.floor(minHz / binHz));
    const maxBin = Math.min(mags.length - 1, Math.floor(maxHz / binHz));
    
    // Vectorized accumulation with threshold filtering
    for (let k = minBin; k <= maxBin; k++) {
      const mag = mags[k];
      if (mag > PCD_THRESHOLD) { // apply magnitude threshold
        const pc = pcdLookupTable[k];
        pcd[pc] += mag * mag; // power weighting
      }
    }
    
    // Apply power normalization and normalize
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      if (PCD_NORMALIZE !== 1.0) {
        pcd[i] = Math.pow(pcd[i], PCD_NORMALIZE);
      }
      sum += pcd[i];
    }
    if (sum > 0) {
      const invSum = 1 / sum;
      for (let i = 0; i < 12; i++) pcd[i] *= invSum;
    }
    return pcd;
  }

  // Optimized peak detection with early termination
  function estimatePrimary(mags, sampleRate, minHz, maxHz){
    const N2 = mags.length;
    const binHz = sampleRate / (N2 * 2);
    const kMin = Math.max(2, Math.floor(minHz / binHz));
    const kMax = Math.min(N2 - 3, Math.floor(maxHz / binHz));

    // Find max bin with early termination for very weak signals
    let k = kMin, maxVal = 0;
    const threshold = 1e-6; // Skip very weak signals early
    
    for (let i = kMin; i <= kMax; i++) {
      const v = mags[i];
      if (v > maxVal) { maxVal = v; k = i; }
    }
    if (maxVal < threshold) return null;

    // Reduced neighborhood for prominence (faster)
    const w = 10; // reduced from 20
    const from = Math.max(kMin, k - w);
    const to = Math.min(kMax, k + w);
    
    // Fast median approximation using 3-point estimate
    let sum = 0, count = 0;
    for (let i = from; i <= to; i += 2) { // sample every other bin
      if (i !== k) { sum += mags[i]; count++; }
    }
    const avgNeighbor = count > 0 ? sum / count : 0;
    const prominenceDb = avgNeighbor > 0 ? 20 * Math.log10((maxVal + 1e-12) / (avgNeighbor + 1e-12)) : 0;

    // Parabolic interpolation (unchanged - already efficient)
    const a = mags[k - 1], b = mags[k], c = mags[k + 1];
    const denom = (a - 2 * b + c) || 1e-12;
    const delta = 0.5 * (a - c) / denom;
    const kRef = k + Math.max(-1, Math.min(1, delta));
    const freq = kRef * binHz;

    return { freq, kRef, prominenceDb };
  }

  // ===== DOM / Canvas =====
  const startBtn = document.getElementById('start');
  const stopBtn  = document.getElementById('stop');
  const resetRot = document.getElementById('resetRot');
  const statusEl = document.getElementById('status');
  const pcdText  = document.getElementById('pcdText');
  const tuneEl   = document.getElementById('tuneReadout');
  const canvas   = document.getElementById('ring');
  const ctx      = canvas.getContext('2d', { alpha: true });
  
  // DFT display elements (now in footer)
  const dftMagnitudes = document.getElementById('dft-magnitudes');
  const dftPhases = document.getElementById('dft-phases');
  
  // 3D visualization elements
  const cubeCanvas = document.getElementById('cubeCanvas');
  const reset3DBtn = document.getElementById('reset3D');
  const show3DData = document.getElementById('show3DData');
  


  // Settings controls
  const reactRange = document.getElementById('reactRange');
  const reactVal   = document.getElementById('reactVal');
  const promRange  = document.getElementById('promRange');
  const promVal    = document.getElementById('promVal');
  const rmsRange   = document.getElementById('rmsRange');
  const rmsVal     = document.getElementById('rmsVal');
  const refA4Input = document.getElementById('refA4Input');
  const windowRange = document.getElementById('windowRange');
  const windowVal   = document.getElementById('windowVal');
  const hopRange    = document.getElementById('hopRange');
  const hopVal      = document.getElementById('hopVal');
  const smoothRange = document.getElementById('smoothRange');
  const smoothVal   = document.getElementById('smoothVal');
  const minHzRange  = document.getElementById('minHzRange');
  const minHzVal    = document.getElementById('minHzVal');
  const maxHzRange  = document.getElementById('maxHzRange');
  const maxHzVal    = document.getElementById('maxHzVal');
  const tunerMinRange = document.getElementById('tunerMinRange');
  const tunerMinVal   = document.getElementById('tunerMinVal');
  const tunerMaxRange = document.getElementById('tunerMaxRange');
  const tunerMaxVal   = document.getElementById('tunerMaxVal');
  const noteNames     = document.getElementById('noteNames');
  const pcdRmsRange   = document.getElementById('pcdRmsRange');
  const pcdRmsVal     = document.getElementById('pcdRmsVal');
  const pcdThreshRange = document.getElementById('pcdThreshRange');
  const pcdThreshVal   = document.getElementById('pcdThreshVal');
  const pcdNormRange   = document.getElementById('pcdNormRange');
  const pcdNormVal     = document.getElementById('pcdNormVal');

  // Note naming convention change
  noteNames.addEventListener('change', () => {
    const convention = noteNames.value;
    currentNoteLabels = NOTE_LABELS[convention];
    // Redraw immediately to show new labels
    if (window.currentPCD) {
      drawRing(window.currentPCD);
    }
  });

  reactRange.addEventListener('input', () => {
    TUNER.reactivity = parseFloat(reactRange.value);
    reactVal.textContent = TUNER.reactivity.toFixed(2);
  });
  promRange.addEventListener('input', () => {
    TUNER.minProminence = parseFloat(promRange.value);
    promVal.textContent = TUNER.minProminence.toFixed(1) + ' dB';
  });
  rmsRange.addEventListener('input', () => {
    TUNER.minRMS = parseFloat(rmsRange.value);
    rmsVal.textContent = TUNER.minRMS.toFixed(4);
  });
  refA4Input.addEventListener('input', () => {
    const value = parseFloat(refA4Input.value);
    if (value >= 400 && value <= 480) { // validate range
      REF_A4 = value;
    }
  });
  windowRange.addEventListener('input', () => {
    const exp = parseInt(windowRange.value);
    WINDOW_SIZE = Math.pow(2, exp);
    windowVal.textContent = WINDOW_SIZE.toString();
  });
  hopRange.addEventListener('input', () => {
    const exp = parseInt(hopRange.value);
    HOP_SIZE = Math.pow(2, exp);
    hopVal.textContent = HOP_SIZE.toString();
  });
  smoothRange.addEventListener('input', () => {
    SMOOTHING = parseFloat(smoothRange.value);
    smoothVal.textContent = SMOOTHING.toFixed(2);
  });
  minHzRange.addEventListener('input', () => {
    MIN_HZ = parseFloat(minHzRange.value);
    minHzVal.textContent = MIN_HZ.toFixed(0) + ' Hz';
  });
  maxHzRange.addEventListener('input', () => {
    MAX_HZ = parseFloat(maxHzRange.value);
    maxHzVal.textContent = MAX_HZ.toFixed(0) + ' Hz';
  });
  tunerMinRange.addEventListener('input', () => {
    TUNER.minHz = parseFloat(tunerMinRange.value);
    tunerMinVal.textContent = TUNER.minHz.toFixed(0) + ' Hz';
  });
  tunerMaxRange.addEventListener('input', () => {
    TUNER.maxHz = parseFloat(tunerMaxRange.value);
    tunerMaxVal.textContent = TUNER.maxHz.toFixed(0) + ' Hz';
  });
  pcdRmsRange.addEventListener('input', () => {
    PCD_MIN_RMS = parseFloat(pcdRmsRange.value);
    pcdRmsVal.textContent = PCD_MIN_RMS.toFixed(4);
  });
  pcdThreshRange.addEventListener('input', () => {
    PCD_THRESHOLD = parseFloat(pcdThreshRange.value);
    pcdThreshVal.textContent = PCD_THRESHOLD.toFixed(3);
  });
  pcdNormRange.addEventListener('input', () => {
    PCD_NORMALIZE = parseFloat(pcdNormRange.value);
    pcdNormVal.textContent = PCD_NORMALIZE.toFixed(1);
  });

  // ===== Ring drawing variables =====
  let userRotation = 0; // radians
  let needleAngleSm = null; // smoothed angle (radians)
  let centsSm = null;       // smoothed cents display
  let lastPrimary = null;   // raw latest reading for UI

  function setupCanvas(){
    // Get actual rendered size
    const rect = canvas.getBoundingClientRect();
    const size = Math.round(Math.min(rect.width, rect.height));
    
    // Set canvas resolution to match displayed size
    canvas.width = size;
    canvas.height = size;
    
    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    if (dpr > 1) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.scale(dpr, dpr);
      // Reset canvas display size after DPI scaling
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
    }
  }

  function wedgePath(cx, cy, rInner, rOuter, a0, a1){
    const p = new Path2D();
    p.arc(cx, cy, rOuter, a0, a1);
    p.arc(cx, cy, rInner, a1, a0, true);
    p.closePath();
    return p;
  }

  // ===== 3D Scene Setup =====
  let scene3D, camera3D, renderer3D, torus3D, torusContainer3D;
  let currentAudioSphere = null; // Track current audio position sphere
  let currentRMS = 0; // Track current audio RMS level
  let audioTrailPositions = []; // Array to store previous audio positions
  let audioTrailLine = null; // Three.js line object for trail visualization
  let guideLines = { pha5Line: null, pha3Line: null }; // Guide lines for coordinate visualization
  let mouse3D = { x: 0, y: 0 };
  let isMouseDown3D = false;
  let rotationMatrix = new THREE.Matrix4(); // Accumulate rotations in world space
  
  // Torus parameters
  const TORUS_MAJOR_RADIUS = 1.0;  // Major radius of the torus
  const TORUS_MINOR_RADIUS = 0.3;  // Minor radius (tube thickness)
  
  // Hardcoded JSON data as fallback
  const HARDCODED_DATA = {
    notes: {
      "Mag3": [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
      "Pha3": [0.0, -1.5707963267948966, 3.141592653589793, 1.5707963267948966, 0.0, -1.5707963267948966, 3.141592653589793, 1.5707963267948966, 0.0, -1.5707963267948966, 3.141592653589793, 1.5707963267948966],
      "Pha5": [0.0, -2.6179938779914944, 1.0471975511965976, -1.5707963267948966, 2.0943951023931957, -0.5235987755982988, 3.141592653589793, 0.5235987755982989, -2.0943951023931957, 1.5707963267948966, -1.0471975511965979, 2.6179938779914944],
      "Labels": ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    },
    chords: {
      "Mag3": [0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299, 0.7453559924999299],
      "Pha3": [0.4636476090008061, 1.1071487177940904, -1.1071487177940904, -0.4636476090008061, -2.677945044588987, -2.0344439357957027, 2.0344439357957027, 2.677945044588987, 0.4636476090008061, 1.1071487177940904, -1.1071487177940904, -0.4636476090008061, -2.677945044588987, -2.0344439357957027, 2.0344439357957027, 2.677945044588987, 0.4636476090008061, 1.1071487177940904, -1.1071487177940904, -0.4636476090008061, -2.677945044588987, -2.0344439357957027, 2.0344439357957027, 2.677945044588987],
      "Pha5": [0.7853981633974483, -0.26179938779914946, -1.8325957145940461, -2.879793265790644, 1.8325957145940461, 0.7853981633974483, -0.7853981633974483, -1.8325957145940461, 2.879793265790644, 1.8325957145940461, 0.26179938779914946, -0.7853981633974483, -2.356194490192345, 2.879793265790644, 1.3089969389957472, 0.26179938779914946, -1.3089969389957472, -2.356194490192345, 2.356194490192345, 1.3089969389957472, -0.2617993877991494, -1.3089969389957472, -2.879793265790644, 2.356194490192345],
      "Labels": ["CMajor", "Cminor", "C#Major", "C#minor", "DMajor", "Dminor", "D#Major", "D#minor", "EMajor", "Eminor", "FMajor", "Fminor", "F#Major", "F#minor", "GMajor", "Gminor", "G#Major", "G#minor", "AMajor", "Aminor", "A#Major", "A#minor", "BMajor", "Bminor"]
    }
  };
  
  // Note name conversion system
  function convertNoteNames(labels, noteNameFormat) {
    return labels.map(label => {
      if (!label.includes('#') && !label.includes('b')) {
        return label; // Natural notes don't change
      }
      
      const conversions = {
        sharps: {
          'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'
        },
        flats: {
          'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb'
        },
        mixed: {
          'C#': 'C#/Db', 'Db': 'C#/Db', 'D#': 'D#/Eb', 'Eb': 'D#/Eb',
          'F#': 'F#/Gb', 'Gb': 'F#/Gb', 'G#': 'G#/Ab', 'Ab': 'G#/Ab',
          'A#': 'A#/Bb', 'Bb': 'A#/Bb'
        }
      };
      
      // Handle chord names (e.g., "C#Major" -> "DbMajor")
      const baseNote = label.match(/^[A-G][#b]?/)?.[0];
      if (baseNote && conversions[noteNameFormat][baseNote]) {
        return label.replace(baseNote, conversions[noteNameFormat][baseNote]);
      }
      
      return label;
    });
  }
  
  // Convert toroidal coordinates to Cartesian coordinates  
  function toroidalToCartesian(pha5, pha3, mag3) {
    // pha5: primary angle around major radius (0 to 2π)
    // pha3: secondary angle around minor radius (0 to 2π) 
    // mag3: radial distance from tube center (0 to 1, scaled to minor radius)
    
    // mag3 = 0 means at the centerline of the tube
    // mag3 = 1 means at the edge of the tube
    const tubeRadius = mag3 * TORUS_MINOR_RADIUS;
    
    // Standard torus parameterization
    // First, find the position on the major circle
    const majorX = TORUS_MAJOR_RADIUS * Math.cos(pha5);
    const majorZ = TORUS_MAJOR_RADIUS * Math.sin(pha5);
    
    // Then offset by the tube radius in the direction defined by pha3
    const x = majorX + tubeRadius * Math.cos(pha3) * Math.cos(pha5);
    const y = tubeRadius * Math.sin(pha3);  
    const z = majorZ + tubeRadius * Math.cos(pha3) * Math.sin(pha5);
    
    return new THREE.Vector3(x, y, z);
  }

  // Load and plot JSON waypoint data
  async function loadAndPlotJSON(filename) {
    try {
      console.log(`Attempting to load: json/${filename}`);
      const response = await fetch(`json/${filename}`);
      
      console.log('Response status:', response.status, response.statusText);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const textContent = await response.text();
      console.log('Raw response length:', textContent.length);
      console.log('Raw response (first 500 chars):', JSON.stringify(textContent.substring(0, 500)));
      console.log('Response content type:', response.headers.get('content-type'));
      
      if (textContent.trim() === '') {
        throw new Error('Empty response received');
      }
      
      const data = JSON.parse(textContent);
      console.log(`Successfully loaded ${filename}:`, data);
      
      // Clear any existing objects (except the torus itself)
      // Remove all children except the torus mesh
      const torusToKeep = torusContainer3D.children.find(child => child.geometry && child.geometry.type === 'TorusGeometry');
      torusContainer3D.clear();
      if (torusToKeep) {
        torusContainer3D.add(torusToKeep);
      }
      
      plotJSONPoints(data);
      
    } catch (error) {
      console.error(`Error loading ${filename}:`, error);
      // Fallback to hardcoded data if JSON loading fails
      const dataName = filename.replace('.json', '');
      console.log(`Falling back to hardcoded ${dataName} data...`);
      
      if (HARDCODED_DATA[dataName]) {
        plotJSONPoints(HARDCODED_DATA[dataName]);
      } else {
        console.error(`No hardcoded data available for ${dataName}`);
        addTestObjects(); // Final fallback
      }
    }
  }

  function plotJSONPoints(data, colorOffset = 0) {
    const { Mag3, Pha3, Pha5, Labels } = data;
    
    if (!Mag3 || !Pha3 || !Pha5 || !Labels) {
      console.error('Invalid JSON structure. Expected Mag3, Pha3, Pha5, and Labels arrays.');
      return;
    }
    
    // Get current note name format setting
    const noteNameFormat = document.getElementById('noteNames').value;
    const convertedLabels = convertNoteNames(Labels, noteNameFormat);
    
    const numPoints = Math.min(Mag3.length, Pha3.length, Pha5.length, Labels.length);
    
    for (let i = 0; i < numPoints; i++) {
      const mag3 = Mag3[i];
      const pha3 = Pha3[i]; 
      const pha5 = Pha5[i];
      const label = convertedLabels[i];
      
      // Calculate position using our coordinate system
      const position = toroidalToCartesian(pha5, pha3, mag3);
      
      // Create colored tetrahedron for each point (more efficient than cubes)
      const waypointSize = parseFloat(document.getElementById('waypointSize').value);
      const pyramidGeo = new THREE.TetrahedronGeometry(waypointSize);
      // Use pha5 coordinate (-π to +π) to determine hue for intuitive torus orientation
      const hue = ((pha5 + Math.PI) / (2 * Math.PI)) * 360; // Map -π to +π → 0 to 360° hue
      const pyramidMat = new THREE.MeshLambertMaterial({ 
        color: new THREE.Color(`hsl(${hue}, 70%, 60%)`)
      });
      const pyramid = new THREE.Mesh(pyramidGeo, pyramidMat);
      pyramid.position.copy(position);
      torusContainer3D.add(pyramid);

      // Create text label
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(64, label.length * 8); // Adjust width for longer labels
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(label, canvas.width/2, 20);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({ 
        map: texture,
        depthTest: false,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      
      // Position text near the cube but outside for visibility
      const labelPosition = toroidalToCartesian(pha5, pha3, Math.min(mag3 + 0.3, 1.1));
      sprite.position.copy(labelPosition);
      sprite.scale.set(0.2, 0.1, 1);
      torusContainer3D.add(sprite);
    }
    
    console.log(`Plotted ${numPoints} points from JSON data`);
  }
  
  function update3DVisualization() {
    const showData = show3DData.value;
    
    // Clear existing objects (except torus)
    const torusToKeep = torusContainer3D.children.find(child => child.geometry && child.geometry.type === 'TorusGeometry');
    torusContainer3D.clear();
    if (torusToKeep) {
      torusContainer3D.add(torusToKeep);
    }
    
    // Plot data based on selection
    switch(showData) {
      case 'notes':
        plotJSONPoints(HARDCODED_DATA.notes, 0);
        break;
      case 'chords':
        plotJSONPoints(HARDCODED_DATA.chords, 0);
        break;
      case 'both':
        plotJSONPoints(HARDCODED_DATA.notes, 0);
        plotJSONPoints(HARDCODED_DATA.chords, 12); // Different color offset
        break;
      case 'neither':
        // Empty torus
        break;
    }
  }

  function addTestObjects() {
    // Test pyramid at center of torus
    const testPyramidGeo = new THREE.TetrahedronGeometry(0.08);
    const testPyramidMat = new THREE.MeshLambertMaterial({ color: 0xff4444 });
    const testPyramid = new THREE.Mesh(testPyramidGeo, testPyramidMat);
    testPyramid.position.set(0, 0, 0);
    torusContainer3D.add(testPyramid); // Add to container so it rotates with the whole system

    // Test objects at various toroidal coordinates
    const testPositions = [
      { pha5: 0, pha3: 0, mag3: 0, color: 0x44ff44 },             // Green at centerline of tube
      { pha5: Math.PI/2, pha3: 0, mag3: 0, color: 0xffff44 },    // Yellow at quarter turn, centerline
      { pha5: Math.PI, pha3: 0, mag3: 0, color: 0xff44ff },      // Magenta at opposite side, centerline
      { pha5: 1.5*Math.PI, pha3: 0, mag3: 0, color: 0x44ffff },  // Cyan at three-quarter turn, centerline
      { pha5: 0, pha3: Math.PI/2, mag3: 0.3, color: 0xffffff },  // White testing pha3 rotation, partial radius
      { pha5: Math.PI/4, pha3: Math.PI, mag3: 0.5, color: 0xff8800 } // Orange testing different parameters
    ];

    testPositions.forEach((pos, index) => {
      const position = toroidalToCartesian(pos.pha5, pos.pha3, pos.mag3);
      
      // Small pyramid at the position
      const pyramidGeo = new THREE.TetrahedronGeometry(0.04);
      const pyramidMat = new THREE.MeshLambertMaterial({ color: pos.color });
      const pyramid = new THREE.Mesh(pyramidGeo, pyramidMat);
      pyramid.position.copy(position);
      torusContainer3D.add(pyramid); // Add to container so it rotates with the whole system

      // Text label positioned outside the torus for visibility
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`P${index + 1}`, 64, 20);
      ctx.fillText(`(${pos.pha5.toFixed(1)}, ${pos.pha3.toFixed(1)}, ${pos.mag3.toFixed(1)})`, 64, 40);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({ 
        map: texture,
        depthTest: false, // Always render on top
        depthWrite: false
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      
      // Position text closer to the cube but still outside the torus for visibility
      const labelPosition = toroidalToCartesian(pos.pha5, pos.pha3, Math.min(pos.mag3 + 0.4, 1.1)); // Slightly outside the cube position
      sprite.position.copy(labelPosition);
      sprite.scale.set(0.25, 0.125, 1);
      torusContainer3D.add(sprite); // Add to container so it rotates with the whole system
    });
  }

  function init3DScene() {
    // Wait for container to have proper dimensions
    const container = cubeCanvas.parentElement;
    const rect = container.getBoundingClientRect();
    
    // If container has no size yet, try again shortly
    if (rect.width === 0 || rect.height === 0) {
      setTimeout(init3DScene, 50);
      return;
    }
    
    // Scene
    scene3D = new THREE.Scene();
    scene3D.background = new THREE.Color(0x1a1a1a);

    // Camera - positioned to center the cube nicely, square aspect ratio
    const size = Math.min(rect.width, rect.height);
    camera3D = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera3D.position.set(0, 0, 3);
    camera3D.lookAt(0, 0, 0);

    // Renderer
    renderer3D = new THREE.WebGLRenderer({ 
      canvas: cubeCanvas, 
      antialias: true,
      alpha: true
    });
    renderer3D.setSize(size, size);
    renderer3D.setPixelRatio(window.devicePixelRatio);
    renderer3D.setClearColor(0x000000, 0);
    
    // Ensure canvas is square
    cubeCanvas.style.width = size + 'px';
    cubeCanvas.style.height = size + 'px';

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.8);
    scene3D.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(2, 2, 5);
    scene3D.add(directionalLight);

    // Create container for everything that will rotate together
    torusContainer3D = new THREE.Group();
    
    // Create torus geometry - rotated to align with our coordinate system
    const torusGeometry = new THREE.TorusGeometry(TORUS_MAJOR_RADIUS, TORUS_MINOR_RADIUS, 16, 100);
    const torusMaterial = new THREE.MeshLambertMaterial({ 
      color: 0x4488ff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide // Render both sides for better visibility
    });
    torus3D = new THREE.Mesh(torusGeometry, torusMaterial);
    torus3D.position.set(0, 0, 0);
    torus3D.rotation.x = Math.PI / 2; // Rotate just the torus geometry
    
    // Add torus to container
    torusContainer3D.add(torus3D);
    
    // Initialize rotation matrix as identity
    rotationMatrix.identity();
    
    scene3D.add(torusContainer3D);

    // Initialize 3D visualization with default settings
    update3DVisualization();

    // Mouse controls
    cubeCanvas.addEventListener('mousedown', onMouse3DDown);
    cubeCanvas.addEventListener('mousemove', onMouse3DMove);
    cubeCanvas.addEventListener('mouseup', onMouse3DUp);
    cubeCanvas.addEventListener('mouseleave', onMouse3DUp);

    // Touch controls
    cubeCanvas.addEventListener('touchstart', onTouch3DStart);
    cubeCanvas.addEventListener('touchmove', onTouch3DMove);
    cubeCanvas.addEventListener('touchend', onTouch3DEnd);

    // Reset button
    reset3DBtn.addEventListener('click', reset3DOrientation);
    
    // 3D data selector
    show3DData.addEventListener('change', update3DVisualization);
    
    // Note names change listener (update 3D labels when note format changes)
    document.getElementById('noteNames').addEventListener('change', update3DVisualization);

    // Waypoint size change listener
    const waypointSizeSlider = document.getElementById('waypointSize');
    const waypointSizeDisplay = document.getElementById('waypointSizeVal');
    waypointSizeSlider.addEventListener('input', function() {
        waypointSizeDisplay.textContent = parseFloat(this.value).toFixed(3);
        update3DVisualization();
    });

    // Trail length change listener
    const trailLengthSlider = document.getElementById('trailLength');
    const trailLengthDisplay = document.getElementById('trailLengthVal');
    trailLengthSlider.addEventListener('input', function() {
        trailLengthDisplay.textContent = this.value;
        updateAudioTrail(); // Update trail when setting changes
    });

    // Handle window resize
    window.addEventListener('resize', onWindow3DResize);

    // Start render loop
    render3D();
  }

  function onMouse3DDown(event) {
    isMouseDown3D = true;
    mouse3D.x = event.clientX;
    mouse3D.y = event.clientY;
  }

  function onMouse3DMove(event) {
    if (!isMouseDown3D) return;
    
    const deltaX = event.clientX - mouse3D.x;
    const deltaY = event.clientY - mouse3D.y;
    
    // Create rotation matrices for screen-space rotations
    const rotationSpeed = 0.01;
    const rotY = new THREE.Matrix4().makeRotationY(deltaX * rotationSpeed);
    const rotX = new THREE.Matrix4().makeRotationX(deltaY * rotationSpeed);
    
    // Apply rotations in world space order: first Y (horizontal drag), then X (vertical drag)
    rotationMatrix.multiplyMatrices(rotY, rotationMatrix);
    rotationMatrix.multiplyMatrices(rotX, rotationMatrix);
    
    // Apply the accumulated rotation to the container
    torusContainer3D.setRotationFromMatrix(rotationMatrix);
    
    mouse3D.x = event.clientX;
    mouse3D.y = event.clientY;
  }

  function onMouse3DUp() {
    isMouseDown3D = false;
  }

  function onTouch3DStart(event) {
    event.preventDefault();
    const touch = event.touches[0];
    mouse3D.x = touch.clientX;
    mouse3D.y = touch.clientY;
    isMouseDown3D = true;
  }

  function onTouch3DMove(event) {
    event.preventDefault();
    if (!isMouseDown3D) return;
    
    const touch = event.touches[0];
    const deltaX = touch.clientX - mouse3D.x;
    const deltaY = touch.clientY - mouse3D.y;
    
    // Create rotation matrices for screen-space rotations
    const rotationSpeed = 0.01;
    const rotY = new THREE.Matrix4().makeRotationY(deltaX * rotationSpeed);
    const rotX = new THREE.Matrix4().makeRotationX(deltaY * rotationSpeed);
    
    // Apply rotations in world space order: first Y (horizontal drag), then X (vertical drag)
    rotationMatrix.multiplyMatrices(rotY, rotationMatrix);
    rotationMatrix.multiplyMatrices(rotX, rotationMatrix);
    
    // Apply the accumulated rotation to the container
    torusContainer3D.setRotationFromMatrix(rotationMatrix);
    
    mouse3D.x = touch.clientX;
    mouse3D.y = touch.clientY;
  }

  function onTouch3DEnd(event) {
    event.preventDefault();
    isMouseDown3D = false;
  }

    function reset3DOrientation() {
    // Reset rotation matrix to identity
    rotationMatrix.identity();
    // Apply the reset to the container
    torusContainer3D.setRotationFromMatrix(rotationMatrix);
  }

  function onWindow3DResize() {
    const container = cubeCanvas.parentElement;
    const rect = container.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    
    camera3D.aspect = 1; // Keep square aspect ratio
    camera3D.updateProjectionMatrix();
    
    renderer3D.setSize(size, size);
    cubeCanvas.style.width = size + 'px';
    cubeCanvas.style.height = size + 'px';
  }

  function render3D() {
    requestAnimationFrame(render3D);
    renderer3D.render(scene3D, camera3D);
  }
  function pcFillColor(i){ return `hsl(${PC_HUE(i)} ${COLOR.sat}% ${COLOR.light}%)`; }
  function slotBgColor(i){ 
    if (IS_BLACK[i]) {
      // Black keys: extremely dark, nearly pure black
      return 'rgba(5, 5, 5, 0.85)';
    } else {
      // White keys: extremely light, nearly pure white with tiny hue hint
      const hue = PC_HUE(i);
      return `hsla(${hue}, 10%, 98%, 0.7)`;
    }
  }

  // Update DFT display with current PCD
  function updateDFTDisplay(pcd, rms = 0) {
    try {
      // Convert PCD to frequency domain
      const dftResult = pcdToFrequencyDomain(Array.from(pcd));
      
      // Display all 7 magnitudes (k=0..6)
      const magnitudesText = dftResult.amplitudes
        .map((amp, k) => `k=${k}: ${amp.toFixed(4)}`)
        .join('\n');
      
      // Display all 7 phases (k=0..6) 
      const phasesText = dftResult.phases
        .map((phase, k) => `k=${k}: ${phase.toFixed(4)}`)
        .join('\n');
      
      dftMagnitudes.textContent = magnitudesText;
      dftPhases.textContent = phasesText;
      
      // Update 3D audio position in torus
      updateAudioPositionInTorus(dftResult, rms);
    } catch (error) {
      console.error('DFT computation error:', error);
      dftMagnitudes.textContent = 'Error computing DFT: ' + error.message;
      dftPhases.textContent = 'Error computing DFT: ' + error.message;
    }
  }

  function updateAudioPositionInTorus(dftResult, rms = 0) {
    if (!torusContainer3D) return; // 3D not initialized yet
    
    try {
      // Remove previous audio sphere if it exists
      if (currentAudioSphere) {
        torusContainer3D.remove(currentAudioSphere);
        currentAudioSphere = null;
      }
      
      // Check if audio is active (same threshold as PCD computation)
      if (rms < PCD_MIN_RMS) {
        clearAudioTrail(); // Clear trail when audio is not active
        clearGuideLines();  // Clear guide lines when audio is not active
        return; // Hide sphere when audio is not active
      }
      
      // Extract coordinates from DFT coefficients
      const pha5 = dftResult.phases[5]; // k=5 phase → pha5 (-π to +π)
      const pha3 = dftResult.phases[3]; // k=3 phase → pha3 (-π to +π)
      const mag3 = dftResult.amplitudes[3]; // k=3 amplitude → mag3 (0 to 1)
      
      // Create new audio position sphere
      const position = toroidalToCartesian(pha5, pha3, mag3);
      const sphereGeo = new THREE.SphereGeometry(0.08, 16, 12); // Sphere to differentiate from pyramids
      
      // Use pha5 for hue like the waypoints, but make it brighter/more saturated
      const hue = ((pha5 + Math.PI) / (2 * Math.PI)) * 360;
      const sphereMat = new THREE.MeshLambertMaterial({ 
        color: new THREE.Color(`hsl(${hue}, 90%, 70%)`), // More vibrant than waypoints
        emissive: new THREE.Color(`hsl(${hue}, 30%, 20%)`) // Slight glow
      });
      
      currentAudioSphere = new THREE.Mesh(sphereGeo, sphereMat);
      currentAudioSphere.position.copy(position);
      torusContainer3D.add(currentAudioSphere);
      
      // Add current position to trail and update trail visualization
      addToAudioTrail(position);
      
      // Update guide lines to show coordinate system
      updateGuideLines(pha5, pha3, mag3, position);
    } catch (error) {
      console.error('Error updating audio position in torus:', error);
    }
  }
  
  function addToAudioTrail(position) {
    // Add new position to trail array
    audioTrailPositions.push(position.clone());
    
    // Trim trail to maximum length based on settings
    const maxLength = parseInt(document.getElementById('trailLength').value);
    if (audioTrailPositions.length > maxLength) {
      audioTrailPositions.shift(); // Remove oldest position
    }
    
    // Update trail visualization
    updateAudioTrail();
  }
  
  function updateAudioTrail() {
    if (!torusContainer3D) return;
    
    try {
      // Remove existing trail line
      if (audioTrailLine) {
        torusContainer3D.remove(audioTrailLine);
        audioTrailLine = null;
      }
      
      const maxLength = parseInt(document.getElementById('trailLength').value);
      
      // If trail length is 0 or we have less than 2 positions, don't draw trail
      if (maxLength === 0 || audioTrailPositions.length < 2) {
        return;
      }
      
      // Trim trail positions if needed (for when user reduces trail length)
      while (audioTrailPositions.length > maxLength) {
        audioTrailPositions.shift();
      }
      
      // Create trail using small tube segments (more reliable than lines)
      audioTrailLine = new THREE.Group(); // Use group to hold multiple segments
      
      for (let i = 0; i < audioTrailPositions.length - 1; i++) {
        const start = audioTrailPositions[i];
        const end = audioTrailPositions[i + 1];
        
        // Calculate segment direction and length
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();
        
        if (length > 0) {
          // Create thin cylinder between points
          const geometry = new THREE.CylinderGeometry(0.005, 0.005, length, 6); // Very thin tube
          
          // Fade effect: newer segments are brighter
          const opacity = 0.3 + (i / audioTrailPositions.length) * 0.6; // 0.3 to 0.9
          const material = new THREE.MeshBasicMaterial({ 
            color: 0x00ffff,
            opacity: opacity,
            transparent: true,
            depthTest: false,     // Don't test against depth buffer (render on top)
            depthWrite: false     // Don't write to depth buffer
          });
          
          const segment = new THREE.Mesh(geometry, material);
          
          // Position and orient the cylinder
          const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
          segment.position.copy(midpoint);
          
          // Orient cylinder along the direction vector
          const up = new THREE.Vector3(0, 1, 0);
          direction.normalize();
          segment.lookAt(end);
          segment.rotateX(Math.PI / 2); // Adjust for cylinder default orientation
          
          audioTrailLine.add(segment);
        }
      }
      torusContainer3D.add(audioTrailLine);
    } catch (error) {
      console.error('Error updating audio trail:', error);
    }
  }
  
  function clearAudioTrail() {
    audioTrailPositions = [];
    if (audioTrailLine) {
      torusContainer3D.remove(audioTrailLine);
      audioTrailLine = null;
    }
  }
  
  function updateGuideLines(pha5, pha3, mag3, spherePosition) {
    if (!torusContainer3D) return;
    
    try {
      // Clear existing guide lines
      clearGuideLines();
      
      // Calculate tube center position at current pha5 (pha3=0, mag3=0)
      const tubeCenterPosition = toroidalToCartesian(pha5, 0, 0);
      
      // Create pha5 guide line: from torus center (0,0,0) to tube center
      const pha5Points = [
        new THREE.Vector3(0, 0, 0),  // Torus center
        tubeCenterPosition           // Tube center at current pha5
      ];
      const pha5Geometry = new THREE.BufferGeometry().setFromPoints(pha5Points);
      const pha5Material = new THREE.LineBasicMaterial({ 
        color: 0xff4444,      // Red for pha5
        opacity: 0.7,
        transparent: true,
        depthTest: false,
        depthWrite: false
      });
      guideLines.pha5Line = new THREE.Line(pha5Geometry, pha5Material);
      torusContainer3D.add(guideLines.pha5Line);
      
      // Create pha3/mag3 guide line: from tube center to sphere position
      const pha3Points = [
        tubeCenterPosition,  // Tube center
        spherePosition       // Current audio sphere position
      ];
      const pha3Geometry = new THREE.BufferGeometry().setFromPoints(pha3Points);
      const pha3Material = new THREE.LineBasicMaterial({ 
        color: 0x44ff44,      // Green for pha3/mag3
        opacity: 0.7,
        transparent: true,
        depthTest: false,
        depthWrite: false
      });
      guideLines.pha3Line = new THREE.Line(pha3Geometry, pha3Material);
      torusContainer3D.add(guideLines.pha3Line);
      
    } catch (error) {
      console.error('Error updating guide lines:', error);
    }
  }
  
  function clearGuideLines() {
    if (guideLines.pha5Line) {
      torusContainer3D.remove(guideLines.pha5Line);
      guideLines.pha5Line = null;
    }
    if (guideLines.pha3Line) {
      torusContainer3D.remove(guideLines.pha3Line);
      guideLines.pha3Line = null;
    }
  }

  function drawRing(pcd){
    const { width, height } = canvas.getBoundingClientRect();
    const cx = width/2, cy = height/2;
    const rMin = Math.min(width, height)/2;
    const rInner = rMin * RING.innerRadiusRatio;
    const rOuter = rMin * RING.outerRadiusRatio;
    const rLabel = rMin * RING.labelRadiusRatio;

    ctx.clearRect(0,0,width,height);

    const slice = (Math.PI*2)/12;
    const gap = Math.min(RING.gapRadians, slice*0.3);

    const fontPx = Math.max(11, Math.min(18, Math.round(rMin*0.06)));
    ctx.font = `${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i=0;i<12;i++){
      const a0 = RING.baseRotation + userRotation + i*slice + gap/2;
      const a1 = a0 + slice - gap;

      // slot background
      ctx.fillStyle = slotBgColor(i);
      ctx.fill(wedgePath(cx, cy, rInner, rOuter, a0, a1));

      // active value
      const val = pcd[i];
      if (val > 0.001){
        const rVal = rInner + val*(rOuter - rInner);
        ctx.fillStyle = pcFillColor(i);
        ctx.fill(wedgePath(cx, cy, rInner, rVal, a0, a1));
      }

      // labels with halo
      const mid = (a0+a1)/2;
      const lx = cx + Math.cos(mid)*rLabel;
      const ly = cy + Math.sin(mid)*rLabel;

      ctx.lineWidth = Math.max(2, fontPx/5);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(currentNoteLabels[i], lx, ly);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.strokeText(currentNoteLabels[i], lx, ly);
      ctx.fillStyle = '#333333'; ctx.fillText(currentNoteLabels[i], lx, ly);

      // Black key indication removed - using background colors instead
    }

    // Draw tuning needle (smoothed angle)
    if (needleAngleSm != null){
      const hubR  = rMin * TUNER.hubRadiusRatio;
      const tipR  = rMin * TUNER.tipRadiusRatio;
      const tailR = rMin * TUNER.tailRadiusRatio;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(needleAngleSm);
      ctx.strokeStyle = TUNER.needleColor;
      ctx.lineWidth = TUNER.needleWidth;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(tailR, 0);
      ctx.lineTo(tipR, 0);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, hubR, 0, Math.PI*2);
      ctx.fillStyle = 'color-mix(in oklab, currentColor 20%, transparent)';
      ctx.fill();
      ctx.strokeStyle = 'color-mix(in oklab, currentColor 40%, transparent)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();
    }
  }

  // Angle unwrapping helper: get shortest angular difference in [-π, π]
  function wrapDiff(target, current){
    let d = target - current;
    while (d >  Math.PI) d -= 2*Math.PI;
    while (d < -Math.PI) d += 2*Math.PI;
    return d;
  }

  // ===== Drag to rotate =====
  let dragging=false, lastAngle=0;
  function pointAngle(evt){
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX ?? evt.touches?.[0]?.clientX) - rect.left;
    const y = (evt.clientY ?? evt.touches?.[0]?.clientY) - rect.top;
    const cx = rect.width/2, cy = rect.height/2;
    return Math.atan2(y - cy, x - cx);
  }
  function onPointerDown(e){ e.preventDefault(); dragging=true; lastAngle=pointAngle(e); canvas.setPointerCapture?.(e.pointerId ?? 0); }
  function onPointerMove(e){ if (!dragging) return; const a=pointAngle(e); userRotation += (a-lastAngle); lastAngle=a; drawRing(window.currentPCD); }
  function onPointerUp(e){ dragging=false; canvas.releasePointerCapture?.(e.pointerId ?? 0); }
  if ('onpointerdown' in window){
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
  } else {
    canvas.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    canvas.addEventListener('touchstart', onPointerDown, {passive:false});
    window.addEventListener('touchmove', onPointerMove, {passive:false});
    window.addEventListener('touchend', onPointerUp);
    window.addEventListener('touchcancel', onPointerUp);
  }
  resetRot.addEventListener('click', ()=>{ userRotation=0; drawRing(window.currentPCD); });

  // ===== Public hook =====
  window.currentPCD = new Float32Array(12);
  window.drawPending = false; // for throttled drawing

  // ===== Audio + analysis =====
  let audioContext, workletNode, micStream, running=false, sampleRate=48000;
  const workletURL = URL.createObjectURL(new Blob([`
    class Tap extends AudioWorkletProcessor {
      process(inputs){ const ch = inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
    }
    registerProcessor('tap', Tap);
  `], {type:'text/javascript'}));

  function frameRms(buf){
    let s=0; for (let i=0;i<buf.length;i++) s += buf[i]*buf[i];
    return Math.sqrt(s / buf.length);
  }

  async function start(){
    if (running) return;
    running = true; startBtn.disabled = true; stopBtn.disabled = false; statusEl.textContent = 'Starting…';

    audioContext = new (window.AudioContext || window.webkitAudioContext)({latencyHint:'interactive'});
    sampleRate = audioContext.sampleRate;
    await audioContext.audioWorklet.addModule(workletURL);

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false },
      video: false
    });

    const src = audioContext.createMediaStreamSource(micStream);
    const silent = audioContext.createGain(); silent.gain.value = 0;
    workletNode = new AudioWorkletNode(audioContext, 'tap');
    src.connect(workletNode).connect(silent).connect(audioContext.destination);

    let ringBuf = new Float32Array(WINDOW_SIZE);
    let windowFn = hann(WINDOW_SIZE);
    let analysisBuf = new Float32Array(WINDOW_SIZE); // pre-allocate
    let writeIdx = 0, filled = 0, hopCount = 0;

    workletNode.port.onmessage = (ev) => {
      const frame = ev.data; // Float32Array(128)
      for (let i=0;i<frame.length;i++){
        ringBuf[writeIdx++] = frame[i];
        if (writeIdx >= WINDOW_SIZE) writeIdx = 0;
        if (filled < WINDOW_SIZE) filled++;
        hopCount++;
        if (hopCount >= HOP_SIZE && filled >= WINDOW_SIZE){
          hopCount = 0;
          analyze();
        }
      }
    };

    function analyze(){
      // Check if we need to reallocate buffers (window size changed)
      if (ringBuf.length !== WINDOW_SIZE) {
        ringBuf = new Float32Array(WINDOW_SIZE);
        windowFn = hann(WINDOW_SIZE);
        analysisBuf = new Float32Array(WINDOW_SIZE);
        writeIdx = 0; filled = 0; // reset
        return; // skip this frame
      }
      
      // rebuild contiguous window (reuse buffer)
      const start = writeIdx % WINDOW_SIZE;
      const first = ringBuf.subarray(start);
      analysisBuf.set(first, 0);
      analysisBuf.set(ringBuf.subarray(0, start), first.length);

      // windowing (in-place)
      for (let i = 0; i < WINDOW_SIZE; i++) analysisBuf[i] *= windowFn[i];

      // For gating + tuner
      const rms = frameRms(analysisBuf);
      currentRMS = rms; // Store for UI callbacks

      // FFT
      const mags = fftReal(analysisBuf);

      // PCD (only if above RMS threshold)
      let pcd;
      if (rms >= PCD_MIN_RMS) {
        pcd = spectrumToPCD(mags, sampleRate, REF_A4, MIN_HZ, MAX_HZ);
      } else {
        pcd = new Float32Array(12); // silent frame = zero PCD
      }

      // Smooth PCD
      for (let i=0;i<12;i++){
        window.currentPCD[i] = SMOOTHING*window.currentPCD[i] + (1-SMOOTHING)*pcd[i];
      }

      // --- Tuning needle estimation (with smoothing controls) ---
      lastPrimary = null;
      if (TUNER.enabled && rms >= TUNER.minRMS){
        const est = estimatePrimary(mags, sampleRate, TUNER.minHz, TUNER.maxHz);
        if (est && est.prominenceDb >= TUNER.minProminence){
          const midiReal = 69 + 12*Math.log2(est.freq / REF_A4);
          const nearest  = Math.round(midiReal);
          const cents    = (midiReal - nearest) * 100; // positive = sharp
          const pc       = ((nearest % 12) + 12) % 12;

          const slice = (Math.PI*2)/12;
          const a0 = RING.baseRotation + userRotation + pc*slice + RING.gapRadians/2;
          const a1 = a0 + slice - RING.gapRadians;
          const mid = (a0+a1)/2;
          const angleRaw = mid + (cents/100) * slice;

          // initialize smoothed state if null
          if (needleAngleSm == null){ needleAngleSm = angleRaw; }
          if (centsSm == null){ centsSm = cents; }

          // EMA smoothing with angle unwrapping
          const step = Math.max(0.05, Math.min(1.0, TUNER.reactivity)); // clamp
          const dAng = wrapDiff(angleRaw, needleAngleSm);
          needleAngleSm = needleAngleSm + step * dAng;
          centsSm = centsSm + step * (cents - centsSm);

          lastPrimary = { cents, centsSm, pc, freq: est.freq, confDb: est.prominenceDb };
        }
      }

      // Throttled UI updates (reduce draw calls)
      if (!window.drawPending) {
        window.drawPending = true;
        requestAnimationFrame(() => {
          pcdText.textContent = '[' + Array.from(window.currentPCD).map(v=>v.toFixed(3)).join(', ') + ']';
          updateDFTDisplay(window.currentPCD, currentRMS);
          drawRing(window.currentPCD);
          window.drawPending = false;
        });
      }

      if (lastPrimary){
        const name = currentNoteLabels[lastPrimary.pc];
        const centsStr = (lastPrimary.centsSm>=0?'+':'') + lastPrimary.centsSm.toFixed(1);
        tuneEl.textContent = `Primary: ${name}  ${centsStr}¢  (~${lastPrimary.freq.toFixed(1)} Hz, ${lastPrimary.confDb.toFixed(1)} dB)`;
      } else {
        // Hide needle when no active pitch detected
        needleAngleSm = null;
        centsSm = null;
        tuneEl.textContent = '';
      }

      // Event for external consumers
      window.dispatchEvent(new CustomEvent('pcd', {detail: window.currentPCD}));

      statusEl.textContent = `Running @ ${sampleRate} Hz | N=${WINDOW_SIZE} hop=${HOP_SIZE}`;
    }

    setupCanvas();
    drawRing(window.currentPCD);
  }

  function stop(){
    if (!running) return;
    running = false; startBtn.disabled = false; stopBtn.disabled = true; statusEl.textContent = 'Stopped';
    try { workletNode?.disconnect(); } catch {}
    try { audioContext?.close(); } catch {}
    try { micStream?.getTracks().forEach(t=>t.stop()); } catch {}
  }

  startBtn.addEventListener('click', start, { passive: true });
  stopBtn.addEventListener('click', stop, { passive: true });

  // Initial setup
  setupCanvas();
  drawRing(new Float32Array(12)); // Draw empty ring immediately
  
  // Handle window resize
  window.addEventListener('resize', () => {
    setupCanvas();
    drawRing(window.currentPCD);
  });
  
  // Set slider positions to match JavaScript defaults
  document.getElementById('reactRange').value = TUNER.reactivity;
  document.getElementById('promRange').value = TUNER.minProminence;
  document.getElementById('rmsRange').value = TUNER.minRMS;
  document.getElementById('refA4Input').value = REF_A4;
  document.getElementById('windowRange').value = Math.log2(WINDOW_SIZE);
  document.getElementById('hopRange').value = Math.log2(HOP_SIZE);
  document.getElementById('smoothRange').value = SMOOTHING;
  document.getElementById('minHzRange').value = MIN_HZ;
  document.getElementById('maxHzRange').value = MAX_HZ;
  document.getElementById('tunerMinRange').value = TUNER.minHz;
  document.getElementById('tunerMaxRange').value = TUNER.maxHz;
  document.getElementById('pcdRmsRange').value = PCD_MIN_RMS;
  document.getElementById('pcdThreshRange').value = PCD_THRESHOLD;
  document.getElementById('pcdNormRange').value = PCD_NORMALIZE;
  
  // Reflect slider defaults in UI text
  document.getElementById('reactVal').textContent = TUNER.reactivity.toFixed(2);
  document.getElementById('promVal').textContent = TUNER.minProminence.toFixed(1) + ' dB';
  document.getElementById('rmsVal').textContent = TUNER.minRMS.toFixed(4);
  document.getElementById('windowVal').textContent = WINDOW_SIZE.toString();
  document.getElementById('hopVal').textContent = HOP_SIZE.toString();
  document.getElementById('smoothVal').textContent = SMOOTHING.toFixed(2);
  document.getElementById('minHzVal').textContent = MIN_HZ.toFixed(0) + ' Hz';
  document.getElementById('maxHzVal').textContent = MAX_HZ.toFixed(0) + ' Hz';
  document.getElementById('tunerMinVal').textContent = TUNER.minHz.toFixed(0) + ' Hz';
  document.getElementById('tunerMaxVal').textContent = TUNER.maxHz.toFixed(0) + ' Hz';
  document.getElementById('pcdRmsVal').textContent = PCD_MIN_RMS.toFixed(4);
  document.getElementById('pcdThreshVal').textContent = PCD_THRESHOLD.toFixed(3);
  document.getElementById('pcdNormVal').textContent = PCD_NORMALIZE.toFixed(1);

  // Initialize visualizations after DOM is fully laid out
  function initializeVisualizations() {
    // Ensure both containers are properly sized
    setupCanvas();
    init3DScene();
    // Initial draw of the ring
    drawRing(window.currentPCD);
  }
  
  // Wait for layout to settle before initializing
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initializeVisualizations, 50));
  } else {
    setTimeout(initializeVisualizations, 50);
  }
