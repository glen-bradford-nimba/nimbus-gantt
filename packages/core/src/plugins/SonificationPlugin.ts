// ─── Sonification Plugin ────────────────────────────────────────────────────
// Turn the Gantt chart into music. Each task becomes a sound: pitch maps to
// row index, duration to bar width, volume to progress, and stereo pan to
// entity group. A playhead sweeps the timeline chronologically, triggering
// notes as it crosses task start/end dates.
//
// Uses the Web Audio API exclusively (no external libraries). Compatible
// with Salesforce Locker/LWS (Web Audio API is allowlisted).

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  GanttTask,
  TaskLayout,
} from '../model/types';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface SonificationConfig {
  tempo?: number;           // BPM, default 120
  scale?: 'major' | 'minor' | 'pentatonic' | 'chromatic';
  instrument?: 'sine' | 'square' | 'triangle' | 'sawtooth';
  duration?: number;        // seconds to play through entire timeline, default 10
  volume?: number;          // 0-1, default 0.3
}

// ─── Scale Definitions ─────────────────────────────────────────────────────

const SCALES: Record<string, number[]> = {
  major:      [0, 2, 4, 5, 7, 9, 11],      // C D E F G A B
  minor:      [0, 2, 3, 5, 7, 8, 10],       // C D Eb F G Ab Bb
  pentatonic: [0, 2, 4, 7, 9],              // C D E G A
  chromatic:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

// C4 = 261.63 Hz (middle C)
const C4_FREQ = 261.63;

function noteToFreq(semitones: number): number {
  return C4_FREQ * Math.pow(2, semitones / 12);
}

/** Map a row index to a frequency using the selected scale */
function rowToFreq(rowIndex: number, scale: number[], octaveBoost: boolean): number {
  const scaleLen = scale.length;
  const octave = Math.floor(rowIndex / scaleLen);
  const degree = rowIndex % scaleLen;
  const semitones = scale[degree] + octave * 12;
  return noteToFreq(octaveBoost ? semitones + 12 : semitones);
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const STYLE_ID = 'nimbus-gantt-sonification-styles';
const WAVEFORM_HEIGHT = 64;
const WAVEFORM_BAR_COUNT = 64;

// ADSR envelope
const ATTACK = 0.05;
const DECAY = 0.1;
const SUSTAIN_LEVEL = 0.7;
const RELEASE = 0.2;

// Playhead
const PLAYHEAD_COLOR = '#F6AD55';
const PLAYHEAD_WIDTH = 2;
const GLOW_COLOR = 'rgba(246, 173, 85, 0.35)';
const GLOW_BLUR = 12;

// ─── CSS ───────────────────────────────────────────────────────────────────

const SONIFICATION_CSS = `
  .ng-sonification-controls {
    position: absolute;
    bottom: 12px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(26, 32, 44, 0.95);
    border: 1px solid #2d3748;
    border-radius: 8px;
    padding: 8px 12px;
    z-index: 900;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 12px;
    color: #e2e8f0;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    user-select: none;
    transition: opacity 200ms ease;
  }
  .ng-sonification-controls.ng-hidden {
    opacity: 0;
    pointer-events: none;
  }
  .ng-son-btn {
    border: none;
    background: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    transition: background 150ms ease;
  }
  .ng-son-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }
  .ng-son-btn--active {
    background: rgba(246, 173, 85, 0.25);
    color: #F6AD55;
  }
  .ng-son-sep {
    width: 1px;
    height: 24px;
    background: #2d3748;
  }
  .ng-son-label {
    font-size: 10px;
    color: #a0aec0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .ng-son-slider {
    width: 60px;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: #2d3748;
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }
  .ng-son-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #e2e8f0;
    cursor: pointer;
  }
  .ng-son-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #e2e8f0;
    border: none;
    cursor: pointer;
  }
  .ng-son-select {
    background: #2d3748;
    color: #e2e8f0;
    border: 1px solid #4a5568;
    border-radius: 4px;
    padding: 2px 4px;
    font-size: 11px;
    cursor: pointer;
    outline: none;
  }

  .ng-sonification-waveform {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: ${WAVEFORM_HEIGHT}px;
    z-index: 850;
    pointer-events: none;
    transition: opacity 300ms ease;
  }
  .ng-sonification-waveform.ng-hidden {
    opacity: 0;
  }
  .ng-sonification-waveform canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
`;

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = SONIFICATION_CSS;
  document.head.appendChild(style);
}

function removeStyles(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

// ─── Active Note Tracking ──────────────────────────────────────────────────

interface ActiveNote {
  taskId: string;
  oscillator: OscillatorNode;
  gainNode: GainNode;
  panNode: StereoPannerNode;
}

// ─── Plugin Factory ────────────────────────────────────────────────────────

export function SonificationPlugin(config?: SonificationConfig): NimbusGanttPlugin {
  // ── Resolved config ──────────────────────────────────────────────────
  let tempo = config?.tempo ?? 120;
  let scaleName = config?.scale ?? 'major';
  let instrument: OscillatorType = config?.instrument ?? 'sine';
  let playDuration = config?.duration ?? 10;
  let volume = config?.volume ?? 0.3;

  let host: PluginHost | null = null;

  // ── Audio state ──────────────────────────────────────────────────────
  let audioCtx: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let analyserData: Uint8Array<ArrayBuffer> | null = null;

  const activeNotes = new Map<string, ActiveNote>();

  // ── Playback state ───────────────────────────────────────────────────
  type PlayState = 'stopped' | 'playing' | 'paused';
  let playState: PlayState = 'stopped';
  let playStartTime = 0;       // audioCtx time when playback started
  let playProgress = 0;        // 0-1 position through timeline
  let pauseProgress = 0;       // progress at time of pause
  let animFrameId = 0;

  // Timeline boundaries (computed from tasks)
  let timelineStartMs = 0;
  let timelineEndMs = 0;
  let timelineDurationMs = 0;

  // ── DOM references ───────────────────────────────────────────────────
  let controlsEl: HTMLDivElement | null = null;
  let waveformEl: HTMLDivElement | null = null;
  let waveformCanvas: HTMLCanvasElement | null = null;
  let waveformCtx: CanvasRenderingContext2D | null = null;
  let playBtn: HTMLButtonElement | null = null;
  let stopBtn: HTMLButtonElement | null = null;

  const unsubs: (() => void)[] = [];

  // Cached task info for sonification
  interface SonTask {
    id: string;
    startMs: number;
    endMs: number;
    rowIndex: number;
    progress: number;
    groupId: string;
    isCritical: boolean;
    isOverdue: boolean;
  }
  let sonTasks: SonTask[] = [];
  let groupIds: string[] = [];

  // ── Audio Setup ──────────────────────────────────────────────────────

  function ensureAudioContext(): void {
    if (audioCtx) return;

    const AudioContextClass =
      (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) ||
      null;
    if (!AudioContextClass) return;

    audioCtx = new AudioContextClass();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = volume;

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyserData = new Uint8Array(analyser.frequencyBinCount);

    masterGain.connect(analyser);
    analyser.connect(audioCtx.destination);
  }

  function resumeAudioContext(): void {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // ── Task Preparation ─────────────────────────────────────────────────

  function prepareTasks(): void {
    if (!host) return;
    const state = host.getState();
    const now = Date.now();

    // Compute timeline boundaries
    let minStart = Infinity;
    let maxEnd = -Infinity;

    const taskArr: SonTask[] = [];
    const groupSet = new Set<string>();

    // Build a flat visible list with row indices
    const flatIds = state.flatVisibleIds;
    const idToRow = new Map<string, number>();
    for (let i = 0; i < flatIds.length; i++) {
      idToRow.set(flatIds[i], i);
    }

    for (const [id, task] of state.tasks) {
      const startMs = parseDate(task.startDate).getTime();
      const endMs = parseDate(task.endDate).getTime();
      if (startMs < minStart) minStart = startMs;
      if (endMs > maxEnd) maxEnd = endMs;

      const gid = task.groupId || '__default__';
      groupSet.add(gid);

      const row = idToRow.get(id) ?? 0;
      const overdue = !task.isCompleted && endMs < now && (task.progress ?? 0) < 1;

      taskArr.push({
        id,
        startMs,
        endMs,
        rowIndex: row,
        progress: task.progress ?? 0,
        groupId: gid,
        isCritical: false, // Will be updated if CriticalPathPlugin data is available
        isOverdue: overdue,
      });
    }

    sonTasks = taskArr;
    groupIds = Array.from(groupSet);
    timelineStartMs = minStart === Infinity ? 0 : minStart;
    timelineEndMs = maxEnd === -Infinity ? 0 : maxEnd;
    timelineDurationMs = Math.max(timelineEndMs - timelineStartMs, 1);
  }

  // ── Note Trigger / Release ───────────────────────────────────────────

  function triggerNote(task: SonTask): void {
    if (!audioCtx || !masterGain || activeNotes.has(task.id)) return;

    const scale = SCALES[scaleName] || SCALES.major;
    const freq = rowToFreq(task.rowIndex, scale, task.isCritical);

    // Create oscillator
    const osc = audioCtx.createOscillator();
    osc.type = instrument;
    osc.frequency.value = freq;

    // Slight detune for overdue tasks
    if (task.isOverdue) {
      osc.detune.value = 25; // quarter-tone sharp = dissonant
    }

    // Volume based on progress
    const noteVolume = 0.3 + task.progress * 0.7;
    const overdueBoost = task.isOverdue ? 1.3 : 1.0;
    const finalVolume = Math.min(noteVolume * overdueBoost, 1.0);

    // Gain node for ADSR envelope
    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    // Attack
    gainNode.gain.linearRampToValueAtTime(finalVolume, audioCtx.currentTime + ATTACK);
    // Decay to sustain
    gainNode.gain.linearRampToValueAtTime(
      finalVolume * SUSTAIN_LEVEL,
      audioCtx.currentTime + ATTACK + DECAY,
    );

    // Stereo pan based on group
    const panNode = audioCtx.createStereoPanner();
    if (groupIds.length <= 1) {
      panNode.pan.value = 0;
    } else {
      const groupIndex = groupIds.indexOf(task.groupId);
      // Map index to -1..1 range
      panNode.pan.value = groupIds.length > 1
        ? (groupIndex / (groupIds.length - 1)) * 2 - 1
        : 0;
    }

    // Connect: osc → gain → pan → master
    osc.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(masterGain);

    osc.start();

    activeNotes.set(task.id, { taskId: task.id, oscillator: osc, gainNode, panNode });
  }

  function releaseNote(taskId: string): void {
    const note = activeNotes.get(taskId);
    if (!note || !audioCtx) return;

    const now = audioCtx.currentTime;
    note.gainNode.gain.cancelScheduledValues(now);
    note.gainNode.gain.setValueAtTime(note.gainNode.gain.value, now);
    note.gainNode.gain.linearRampToValueAtTime(0, now + RELEASE);

    note.oscillator.stop(now + RELEASE + 0.05);
    activeNotes.delete(taskId);
  }

  function releaseAllNotes(): void {
    for (const taskId of Array.from(activeNotes.keys())) {
      releaseNote(taskId);
    }
  }

  // ── Playback Loop ────────────────────────────────────────────────────

  function playbackLoop(): void {
    if (playState !== 'playing' || !audioCtx) return;

    const elapsed = audioCtx.currentTime - playStartTime;
    playProgress = Math.min(elapsed / playDuration, 1.0);

    if (playProgress >= 1.0) {
      stop();
      return;
    }

    // Current timeline position in ms
    const currentMs = timelineStartMs + playProgress * timelineDurationMs;

    // Trigger / release notes based on playhead position
    for (const task of sonTasks) {
      const isActive = currentMs >= task.startMs && currentMs < task.endMs;
      const hasNote = activeNotes.has(task.id);

      if (isActive && !hasNote) {
        triggerNote(task);
      } else if (!isActive && hasNote) {
        releaseNote(task.id);
      }
    }

    // Render waveform
    renderWaveform();

    animFrameId = requestAnimationFrame(playbackLoop);
  }

  // ── Playback Controls ────────────────────────────────────────────────

  function play(): void {
    ensureAudioContext();
    resumeAudioContext();
    if (!audioCtx) return;

    prepareTasks();

    if (playState === 'paused') {
      // Resume from pause position
      playStartTime = audioCtx.currentTime - pauseProgress * playDuration;
    } else {
      // Start fresh
      playStartTime = audioCtx.currentTime;
      playProgress = 0;
    }

    playState = 'playing';
    updatePlayButton();
    showWaveform();
    animFrameId = requestAnimationFrame(playbackLoop);
  }

  function pause(): void {
    if (playState !== 'playing') return;
    playState = 'paused';
    pauseProgress = playProgress;
    releaseAllNotes();
    cancelAnimationFrame(animFrameId);
    updatePlayButton();
  }

  function stop(): void {
    playState = 'stopped';
    playProgress = 0;
    pauseProgress = 0;
    releaseAllNotes();
    cancelAnimationFrame(animFrameId);
    updatePlayButton();
    hideWaveform();
  }

  function togglePlayPause(): void {
    if (playState === 'playing') {
      pause();
    } else {
      play();
    }
  }

  function scrub(dateStr: string): void {
    const targetMs = parseDate(dateStr).getTime();
    const normalizedProgress = Math.max(
      0,
      Math.min((targetMs - timelineStartMs) / timelineDurationMs, 1),
    );

    if (playState === 'playing' && audioCtx) {
      // Adjust start time so playhead jumps to the new position
      playStartTime = audioCtx.currentTime - normalizedProgress * playDuration;
    } else {
      pauseProgress = normalizedProgress;
      playProgress = normalizedProgress;
    }
  }

  // ── DOM Updates ──────────────────────────────────────────────────────

  function updatePlayButton(): void {
    if (!playBtn) return;
    if (playState === 'playing') {
      playBtn.innerHTML = pauseIcon();
      playBtn.classList.add('ng-son-btn--active');
    } else {
      playBtn.innerHTML = playIcon();
      playBtn.classList.remove('ng-son-btn--active');
    }
  }

  function showWaveform(): void {
    if (waveformEl) waveformEl.classList.remove('ng-hidden');
  }

  function hideWaveform(): void {
    if (waveformEl) waveformEl.classList.add('ng-hidden');
  }

  // ── Waveform Visualization ───────────────────────────────────────────

  function renderWaveform(): void {
    if (!analyser || !analyserData || !waveformCtx || !waveformCanvas) return;

    analyser.getByteFrequencyData(analyserData);

    const w = waveformCanvas.width;
    const h = waveformCanvas.height;
    const dpr = window.devicePixelRatio || 1;

    waveformCtx.clearRect(0, 0, w, h);

    // Background with gradient
    const gradient = waveformCtx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(26, 32, 44, 0)');
    gradient.addColorStop(1, 'rgba(26, 32, 44, 0.6)');
    waveformCtx.fillStyle = gradient;
    waveformCtx.fillRect(0, 0, w, h);

    // Draw frequency bars
    const barW = (w / WAVEFORM_BAR_COUNT) * 0.8;
    const gap = (w / WAVEFORM_BAR_COUNT) * 0.2;
    const binStep = Math.floor(analyserData.length / WAVEFORM_BAR_COUNT);

    for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
      // Average a few bins
      let sum = 0;
      for (let j = 0; j < binStep; j++) {
        sum += analyserData[i * binStep + j] ?? 0;
      }
      const avg = sum / binStep;
      const barH = (avg / 255) * h * 0.85;

      const x = i * (barW + gap);
      const y = h - barH;

      // Color gradient from amber to orange
      const hue = 30 + (avg / 255) * 15;
      const lightness = 55 + (avg / 255) * 15;
      waveformCtx.fillStyle = `hsl(${hue}, 90%, ${lightness}%)`;
      waveformCtx.fillRect(x, y, barW, barH);
    }
  }

  // ── SVG Icons (inline to avoid asset dependencies) ───────────────────

  function playIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  }

  function pauseIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
  }

  function stopIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>';
  }

  // ════════════════════════════════════════════════════════════════════════
  // Plugin Object
  // ════════════════════════════════════════════════════════════════════════

  return {
    name: 'SonificationPlugin',

    install(gantt: PluginHost): void {
      host = gantt;
      injectStyles();

      unsubs.push(gantt.on('sonification:play', () => play()));
      unsubs.push(gantt.on('sonification:pause', () => pause()));
      unsubs.push(gantt.on('sonification:stop', () => stop()));
      unsubs.push(
        gantt.on('sonification:scrub', (...args: unknown[]) => {
          const dateStr = typeof args[0] === 'string' ? args[0] : undefined;
          if (dateStr) scrub(dateStr);
        }),
      );
      unsubs.push(
        gantt.on('sonification:configure', (...args: unknown[]) => {
          const newConfig = args[0] as Partial<SonificationConfig> | undefined;
          if (!newConfig) return;
          if (newConfig.tempo !== undefined) tempo = newConfig.tempo;
          if (newConfig.scale !== undefined) scaleName = newConfig.scale;
          if (newConfig.instrument !== undefined) instrument = newConfig.instrument;
          if (newConfig.duration !== undefined) playDuration = newConfig.duration;
          if (newConfig.volume !== undefined) {
            volume = newConfig.volume;
            if (masterGain) masterGain.gain.value = volume;
          }
        }),
      );
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      layouts: TaskLayout[],
    ): void {
      if (playState === 'stopped' || !host) return;

      const { headerHeight } = state.config;
      const scrollX = state.scrollX;
      const scrollY = state.scrollY;
      const bodyTop = headerHeight;
      const timeScale = host.getTimeScale();

      // Current date position
      const currentMs = timelineStartMs + playProgress * timelineDurationMs;
      const currentDate = new Date(currentMs);
      const playheadX = timeScale.dateToX(currentDate);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, bodyTop, ctx.canvas.width, ctx.canvas.height - bodyTop);
      ctx.clip();
      ctx.translate(-scrollX, 0);

      // ── Draw playhead line ───────────────────────────────────────────
      ctx.save();
      ctx.shadowColor = PLAYHEAD_COLOR;
      ctx.shadowBlur = GLOW_BLUR;
      ctx.strokeStyle = PLAYHEAD_COLOR;
      ctx.lineWidth = PLAYHEAD_WIDTH;
      ctx.beginPath();
      ctx.moveTo(playheadX, bodyTop);
      ctx.lineTo(playheadX, ctx.canvas.height + scrollY);
      ctx.stroke();
      ctx.restore();

      // ── Highlight active (playing) task bars ─────────────────────────
      const layoutMap = new Map<string, TaskLayout>();
      for (const layout of layouts) {
        layoutMap.set(layout.taskId, layout);
      }

      for (const note of activeNotes.values()) {
        const layout = layoutMap.get(note.taskId);
        if (!layout) continue;

        const barX = layout.x;
        const barY = layout.barY - scrollY;
        const barW = layout.width;
        const barH = layout.barHeight;

        if (barY + barH < bodyTop || barY > ctx.canvas.height) continue;

        // Pulsing glow effect — sine wave oscillation
        const pulsePhase = ((audioCtx?.currentTime ?? 0) * 4) % (2 * Math.PI);
        const pulseAlpha = 0.15 + 0.15 * Math.sin(pulsePhase);

        ctx.save();
        ctx.globalAlpha = pulseAlpha;
        ctx.shadowColor = GLOW_COLOR;
        ctx.shadowBlur = GLOW_BLUR;
        ctx.fillStyle = PLAYHEAD_COLOR;

        const radius = Math.min(state.config.theme.barBorderRadius, barW / 2, barH / 2);
        ctx.beginPath();
        ctx.moveTo(barX + radius, barY);
        ctx.lineTo(barX + barW - radius, barY);
        ctx.arcTo(barX + barW, barY, barX + barW, barY + radius, radius);
        ctx.lineTo(barX + barW, barY + barH - radius);
        ctx.arcTo(barX + barW, barY + barH, barX + barW - radius, barY + barH, radius);
        ctx.lineTo(barX + radius, barY + barH);
        ctx.arcTo(barX, barY + barH, barX, barY + barH - radius, radius);
        ctx.lineTo(barX, barY + radius);
        ctx.arcTo(barX, barY, barX + radius, barY, radius);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    },

    renderDOM(container: HTMLElement, _state: GanttState): void {
      // ── Controls bar ─────────────────────────────────────────────────
      if (!controlsEl) {
        controlsEl = document.createElement('div');
        controlsEl.className = 'ng-sonification-controls';

        // Play/Pause button
        playBtn = document.createElement('button');
        playBtn.className = 'ng-son-btn';
        playBtn.innerHTML = playIcon();
        playBtn.title = 'Play / Pause';
        playBtn.addEventListener('click', () => togglePlayPause());
        controlsEl.appendChild(playBtn);

        // Stop button
        stopBtn = document.createElement('button');
        stopBtn.className = 'ng-son-btn';
        stopBtn.innerHTML = stopIcon();
        stopBtn.title = 'Stop';
        stopBtn.addEventListener('click', () => stop());
        controlsEl.appendChild(stopBtn);

        // Separator
        const sep1 = document.createElement('div');
        sep1.className = 'ng-son-sep';
        controlsEl.appendChild(sep1);

        // Tempo slider
        const tempoGroup = document.createElement('div');
        tempoGroup.style.display = 'flex';
        tempoGroup.style.flexDirection = 'column';
        tempoGroup.style.alignItems = 'center';
        tempoGroup.style.gap = '2px';

        const tempoLabel = document.createElement('span');
        tempoLabel.className = 'ng-son-label';
        tempoLabel.textContent = 'Tempo';
        tempoGroup.appendChild(tempoLabel);

        const tempoSlider = document.createElement('input');
        tempoSlider.type = 'range';
        tempoSlider.className = 'ng-son-slider';
        tempoSlider.min = '40';
        tempoSlider.max = '240';
        tempoSlider.value = String(tempo);
        tempoSlider.addEventListener('input', () => {
          tempo = Number(tempoSlider.value);
          // Adjust play duration inversely proportional to tempo
          playDuration = (120 / tempo) * (config?.duration ?? 10);
        });
        tempoGroup.appendChild(tempoSlider);
        controlsEl.appendChild(tempoGroup);

        // Scale selector
        const scaleGroup = document.createElement('div');
        scaleGroup.style.display = 'flex';
        scaleGroup.style.flexDirection = 'column';
        scaleGroup.style.alignItems = 'center';
        scaleGroup.style.gap = '2px';

        const scaleLabel = document.createElement('span');
        scaleLabel.className = 'ng-son-label';
        scaleLabel.textContent = 'Scale';
        scaleGroup.appendChild(scaleLabel);

        const scaleSelect = document.createElement('select');
        scaleSelect.className = 'ng-son-select';
        for (const name of Object.keys(SCALES)) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
          if (name === scaleName) opt.selected = true;
          scaleSelect.appendChild(opt);
        }
        scaleSelect.addEventListener('change', () => {
          scaleName = scaleSelect.value as SonificationConfig['scale'] & string;
        });
        scaleGroup.appendChild(scaleSelect);
        controlsEl.appendChild(scaleGroup);

        // Separator
        const sep2 = document.createElement('div');
        sep2.className = 'ng-son-sep';
        controlsEl.appendChild(sep2);

        // Volume slider
        const volGroup = document.createElement('div');
        volGroup.style.display = 'flex';
        volGroup.style.flexDirection = 'column';
        volGroup.style.alignItems = 'center';
        volGroup.style.gap = '2px';

        const volLabel = document.createElement('span');
        volLabel.className = 'ng-son-label';
        volLabel.textContent = 'Vol';
        volGroup.appendChild(volLabel);

        const volSlider = document.createElement('input');
        volSlider.type = 'range';
        volSlider.className = 'ng-son-slider';
        volSlider.min = '0';
        volSlider.max = '100';
        volSlider.value = String(Math.round(volume * 100));
        volSlider.addEventListener('input', () => {
          volume = Number(volSlider.value) / 100;
          if (masterGain) masterGain.gain.value = volume;
        });
        volGroup.appendChild(volSlider);
        controlsEl.appendChild(volGroup);

        container.appendChild(controlsEl);
      }

      // ── Waveform bar ─────────────────────────────────────────────────
      if (!waveformEl) {
        waveformEl = document.createElement('div');
        waveformEl.className = 'ng-sonification-waveform ng-hidden';

        waveformCanvas = document.createElement('canvas');
        waveformCtx = waveformCanvas.getContext('2d');

        // Size canvas to container
        const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
        const rect = container.getBoundingClientRect();
        waveformCanvas.width = rect.width * dpr;
        waveformCanvas.height = WAVEFORM_HEIGHT * dpr;
        waveformCanvas.style.width = '100%';
        waveformCanvas.style.height = WAVEFORM_HEIGHT + 'px';
        if (waveformCtx) waveformCtx.scale(dpr, dpr);

        waveformEl.appendChild(waveformCanvas);
        container.appendChild(waveformEl);
      }
    },

    destroy(): void {
      for (const unsub of unsubs) unsub();
      unsubs.length = 0;

      stop();
      releaseAllNotes();

      if (audioCtx) {
        audioCtx.close();
        audioCtx = null;
      }
      masterGain = null;
      analyser = null;
      analyserData = null;

      if (controlsEl) { controlsEl.remove(); controlsEl = null; }
      if (waveformEl) { waveformEl.remove(); waveformEl = null; }
      waveformCanvas = null;
      waveformCtx = null;
      playBtn = null;
      stopBtn = null;

      removeStyles();
      host = null;
      sonTasks = [];
      groupIds = [];
    },
  };
}
