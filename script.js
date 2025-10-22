
import { pcdToFrequencyDomain } from './pcd-dft.js';
import { AudioProcessor, DEFAULT_AUDIO_CONFIG, DEFAULT_TUNER_CONFIG } from './audio/processor.js';
  
  // =========================
  // ====== CONFIG HERE ======
  // =========================
  const audioDefaults = { ...DEFAULT_AUDIO_CONFIG };
  let WINDOW_SIZE = audioDefaults.windowSize;
  let HOP_SIZE    = audioDefaults.hopSize;
  let MIN_HZ      = audioDefaults.minHz;
  let MAX_HZ      = audioDefaults.maxHz;
  let REF_A4      = audioDefaults.refA4;
  let SMOOTHING   = audioDefaults.smoothing;
  
  // PCD filtering parameters
  let PCD_MIN_RMS = audioDefaults.pcdMinRms;      // minimum RMS for PCD calculation
  let PCD_THRESHOLD = audioDefaults.pcdThreshold;    // minimum magnitude to include in PCD
  let PCD_NORMALIZE = audioDefaults.pcdNormalize;      // power scaling for PCD normalization

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
    ...DEFAULT_TUNER_CONFIG,
    needleColor: '#00aaff',
    needleWidth: 3,
    hubRadiusRatio: 0.05,
    tipRadiusRatio: 0.98,
    tailRadiusRatio: 0.20
  };
  let audioProcessor;
  // =========================

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
  const fullscreen3DBtn = document.getElementById('fullscreen3D');
  const cubeContainer = document.getElementById('cube-container');
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
    audioProcessor.updateTuner({ reactivity: TUNER.reactivity });
    reactVal.textContent = TUNER.reactivity.toFixed(2);
  });
  promRange.addEventListener('input', () => {
    TUNER.minProminence = parseFloat(promRange.value);
    audioProcessor.updateTuner({ minProminence: TUNER.minProminence });
    promVal.textContent = TUNER.minProminence.toFixed(1) + ' dB';
  });
  rmsRange.addEventListener('input', () => {
    TUNER.minRMS = parseFloat(rmsRange.value);
    audioProcessor.updateTuner({ minRMS: TUNER.minRMS });
    rmsVal.textContent = TUNER.minRMS.toFixed(4);
  });
  refA4Input.addEventListener('input', () => {
    const value = parseFloat(refA4Input.value);
    if (value >= 400 && value <= 480) { // validate range
      REF_A4 = value;
      audioProcessor.updateConfig({ refA4: REF_A4 });
      REF_A4 = audioProcessor.config.refA4;
    }
  });
  windowRange.addEventListener('input', () => {
    const exp = parseInt(windowRange.value);
    WINDOW_SIZE = Math.pow(2, exp);
    audioProcessor.updateConfig({ windowSize: WINDOW_SIZE });
    WINDOW_SIZE = audioProcessor.config.windowSize;
    windowVal.textContent = WINDOW_SIZE.toString();
  });
  hopRange.addEventListener('input', () => {
    const exp = parseInt(hopRange.value);
    HOP_SIZE = Math.pow(2, exp);
    audioProcessor.updateConfig({ hopSize: HOP_SIZE });
    HOP_SIZE = audioProcessor.config.hopSize;
    hopVal.textContent = HOP_SIZE.toString();
  });
  smoothRange.addEventListener('input', () => {
    SMOOTHING = parseFloat(smoothRange.value);
    audioProcessor.updateConfig({ smoothing: SMOOTHING });
    SMOOTHING = audioProcessor.config.smoothing;
    smoothVal.textContent = SMOOTHING.toFixed(2);
  });
  minHzRange.addEventListener('input', () => {
    MIN_HZ = parseFloat(minHzRange.value);
    audioProcessor.updateConfig({ minHz: MIN_HZ });
    MIN_HZ = audioProcessor.config.minHz;
    MAX_HZ = audioProcessor.config.maxHz;
    maxHzRange.value = MAX_HZ.toString();
    maxHzVal.textContent = MAX_HZ.toFixed(0) + ' Hz';
    minHzVal.textContent = MIN_HZ.toFixed(0) + ' Hz';
  });
  maxHzRange.addEventListener('input', () => {
    MAX_HZ = parseFloat(maxHzRange.value);
    audioProcessor.updateConfig({ maxHz: MAX_HZ });
    MAX_HZ = audioProcessor.config.maxHz;
    MIN_HZ = audioProcessor.config.minHz;
    minHzRange.value = MIN_HZ.toString();
    minHzVal.textContent = MIN_HZ.toFixed(0) + ' Hz';
    maxHzVal.textContent = MAX_HZ.toFixed(0) + ' Hz';
  });
  tunerMinRange.addEventListener('input', () => {
    TUNER.minHz = parseFloat(tunerMinRange.value);
    audioProcessor.updateTuner({ minHz: TUNER.minHz });
    TUNER.minHz = audioProcessor.tunerConfig.minHz;
    tunerMinVal.textContent = TUNER.minHz.toFixed(0) + ' Hz';
  });
  tunerMaxRange.addEventListener('input', () => {
    TUNER.maxHz = parseFloat(tunerMaxRange.value);
    audioProcessor.updateTuner({ maxHz: TUNER.maxHz });
    TUNER.maxHz = audioProcessor.tunerConfig.maxHz;
    tunerMaxVal.textContent = TUNER.maxHz.toFixed(0) + ' Hz';
  });
  pcdRmsRange.addEventListener('input', () => {
    PCD_MIN_RMS = parseFloat(pcdRmsRange.value);
    audioProcessor.updateConfig({ pcdMinRms: PCD_MIN_RMS });
    PCD_MIN_RMS = audioProcessor.config.pcdMinRms;
    pcdRmsVal.textContent = PCD_MIN_RMS.toFixed(4);
  });
  pcdThreshRange.addEventListener('input', () => {
    PCD_THRESHOLD = parseFloat(pcdThreshRange.value);
    audioProcessor.updateConfig({ pcdThreshold: PCD_THRESHOLD });
    PCD_THRESHOLD = audioProcessor.config.pcdThreshold;
    pcdThreshVal.textContent = PCD_THRESHOLD.toFixed(3);
  });
  pcdNormRange.addEventListener('input', () => {
    PCD_NORMALIZE = parseFloat(pcdNormRange.value);
    audioProcessor.updateConfig({ pcdNormalize: PCD_NORMALIZE });
    PCD_NORMALIZE = audioProcessor.config.pcdNormalize;
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

  // ===== 3D Torus Visualizer =====
  const waypointSizeSlider = document.getElementById('waypointSize');
  const waypointSizeValEl = document.getElementById('waypointSizeVal');
  const trailLengthSlider = document.getElementById('trailLength');
  const trailLengthValEl = document.getElementById('trailLengthVal');

  const torusVisualizer = new TorusVisualizer({
    canvas: cubeCanvas,
    container: cubeContainer,
    resetButton: reset3DBtn,
    fullscreenButton: fullscreen3DBtn,
    showDataSelect: show3DData,
    noteNameSelect: noteNames,
    waypointSizeInput: waypointSizeSlider,
    trailLengthInput: trailLengthSlider,
    waypointSizeDisplay: waypointSizeValEl,
    trailLengthDisplay: trailLengthValEl,
  });
  let currentRMS = 0;


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
      torusVisualizer.updateFromAudio(dftResult, rms, PCD_MIN_RMS);
    } catch (error) {
      console.error('DFT computation error:', error);
      dftMagnitudes.textContent = 'Error computing DFT: ' + error.message;
      dftPhases.textContent = 'Error computing DFT: ' + error.message;
    }
  }

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
  window.drawPending = false; // for throttled drawing

  // ===== Audio + analysis =====
  audioProcessor = new AudioProcessor({
    windowSize: WINDOW_SIZE,
    hopSize: HOP_SIZE,
    minHz: MIN_HZ,
    maxHz: MAX_HZ,
    smoothing: SMOOTHING,
    pcdMinRms: PCD_MIN_RMS,
    pcdThreshold: PCD_THRESHOLD,
    pcdNormalize: PCD_NORMALIZE,
    refA4: REF_A4,
    tuner: TUNER,
  });

  window.currentPCD = audioProcessor.getCurrentPcd();

  let isAudioRunning = false;
  let startInProgress = false;

  audioProcessor.addEventListener('statechange', ({ detail }) => {
    isAudioRunning = detail.running;
    startBtn.disabled = detail.running || startInProgress;
    stopBtn.disabled = !detail.running;
    if (detail.running) {
      statusEl.textContent = 'Running…';
    } else if (!startInProgress) {
      statusEl.textContent = 'Stopped';
    }
  });

  audioProcessor.addEventListener('analysis', ({ detail }) => {
    const { pcd, rms, primary } = detail;
    currentRMS = rms;

    statusEl.textContent = `Running @ ${audioProcessor.getSampleRate().toFixed(0)} Hz | N=${audioProcessor.config.windowSize} hop=${audioProcessor.config.hopSize}`;

    if (primary) {
      const slice = (Math.PI * 2) / 12;
      const pc = primary.pitchClass;
      const a0 = RING.baseRotation + userRotation + pc * slice + RING.gapRadians / 2;
      const a1 = a0 + slice - RING.gapRadians;
      const mid = (a0 + a1) / 2;
      const angleRaw = mid + (primary.cents / 100) * slice;

      if (needleAngleSm == null) needleAngleSm = angleRaw;
      if (centsSm == null) centsSm = primary.cents;

      const step = Math.max(0.05, Math.min(1.0, TUNER.reactivity));
      const dAng = wrapDiff(angleRaw, needleAngleSm);
      needleAngleSm = needleAngleSm + step * dAng;
      centsSm = centsSm + step * (primary.cents - centsSm);

      lastPrimary = {
        freq: primary.freq,
        prominenceDb: primary.prominenceDb,
        pc,
        cents: primary.cents,
        centsSm,
      };
    } else {
      lastPrimary = null;
      needleAngleSm = null;
      centsSm = null;
    }

    if (!window.drawPending) {
      window.drawPending = true;
      requestAnimationFrame(() => {
        pcdText.textContent = '[' + Array.from(pcd).map(v => v.toFixed(3)).join(', ') + ']';
        updateDFTDisplay(window.currentPCD, currentRMS);
        drawRing(window.currentPCD);
        window.drawPending = false;
      });
    }

    if (lastPrimary) {
      const name = currentNoteLabels[lastPrimary.pc];
      const centsStr = (lastPrimary.centsSm >= 0 ? '+' : '') + lastPrimary.centsSm.toFixed(1);
      tuneEl.textContent = `Primary: ${name}  ${centsStr}¢  (~${lastPrimary.freq.toFixed(1)} Hz, ${lastPrimary.prominenceDb.toFixed(1)} dB)`;
    } else {
      tuneEl.textContent = '';
    }

    window.dispatchEvent(new CustomEvent('pcd', { detail: window.currentPCD }));
  });

  audioProcessor.addEventListener('error', ({ detail }) => {
    const message = detail?.message || String(detail);
    console.error('Audio processor error:', detail);
    statusEl.textContent = `Error: ${message}`;
    startInProgress = false;
    isAudioRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
  });

  async function start(){
    if (isAudioRunning || startInProgress) return;
    startInProgress = true;
    startBtn.disabled = true;
    stopBtn.disabled = true;
    statusEl.textContent = 'Starting…';
    try {
      await audioProcessor.start();
    } catch (error) {
      const message = error?.message || String(error);
      console.error('Failed to start audio:', error);
      statusEl.textContent = `Error: ${message}`;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      startInProgress = false;
      isAudioRunning = false;
    } finally {
      if (!isAudioRunning) {
        startBtn.disabled = false;
      }
      startInProgress = false;
    }
  }

  async function stop(){
    if (!isAudioRunning && !startInProgress) return;
    stopBtn.disabled = true;
    statusEl.textContent = 'Stopping…';
    try {
      await audioProcessor.stop();
    } finally {
      startInProgress = false;
      isAudioRunning = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      tuneEl.textContent = '';
      needleAngleSm = null;
      centsSm = null;
      lastPrimary = null;
      window.currentPCD.fill(0);
      currentRMS = 0;
      if (!window.drawPending) {
        window.drawPending = true;
        requestAnimationFrame(() => {
          pcdText.textContent = '[' + Array.from(window.currentPCD).map(v => v.toFixed(3)).join(', ') + ']';
          updateDFTDisplay(window.currentPCD, currentRMS);
          drawRing(window.currentPCD);
          window.drawPending = false;
        });
      }
      torusVisualizer.hideAudioState();
      statusEl.textContent = 'Stopped';
    }
  }

  startBtn.addEventListener('click', start, { passive: true });
  stopBtn.addEventListener('click', stop, { passive: true });

  // Initial setup
  setupCanvas();
  drawRing(window.currentPCD); // Draw empty ring immediately
  
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
    torusVisualizer.initialize();
    // Initial draw of the ring
    drawRing(window.currentPCD);
  }
  
  // Wait for layout to settle before initializing
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initializeVisualizations, 50);
    });
  } else {
    setTimeout(initializeVisualizations, 50);
  }
