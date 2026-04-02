// ─── Nimbus Gantt — 3D Holographic Timeline ─────────────────────────────────
// A sci-fi mission-control visualization of project tasks in 3D space.
// Tasks are rendered as glowing extruded bars floating in a dark void.
// Uses Three.js for rendering, OrbitControls for mouse navigation,
// and WebSocket for phone accelerometer integration.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { sampleTasks, sampleDependencies, sampleColorMap } from './sample-data';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TaskMesh {
  id: string;
  group: THREE.Group;
  bar: THREE.Mesh;
  progressBar: THREE.Mesh | null;
  label: THREE.Sprite | null;
  task: typeof sampleTasks[0];
  worldCenter: THREE.Vector3;
}

interface CameraPreset {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DAY_WIDTH = 6;              // World units per day on X axis
const ROW_SPACING = 5;            // Spacing between task rows on Y axis
const GROUP_DEPTH = 40;           // Z spacing between entity groups
const BAR_HEIGHT = 2.0;
const BAR_DEPTH = 3.5;
const LABEL_OFFSET_Y = 2.2;

const SMOOTHING_RETAIN = 0.85;
const SMOOTHING_RAW = 0.15;

// Today baseline
const TODAY = new Date(Date.UTC(2026, 3, 1));
const TODAY_MS = TODAY.getTime();

// ─── Color Utilities ────────────────────────────────────────────────────────

function hexToColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

function darkenHex(hex: string, factor: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(factor);
  return '#' + c.getHexString();
}

function lightenHex(hex: string, factor: number): string {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), factor);
  return '#' + c.getHexString();
}

// ─── Date Utilities ─────────────────────────────────────────────────────────

function dateToDays(iso: string): number {
  const ms = new Date(iso + 'T00:00:00Z').getTime();
  return (ms - TODAY_MS) / 86_400_000;
}

function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m,10)-1]} ${parseInt(d,10)}`;
}

// ─── Grouping ───────────────────────────────────────────────────────────────

interface GroupInfo {
  groupId: string;
  groupName: string;
  zIndex: number;
  tasks: typeof sampleTasks;
}

function buildGroups(): GroupInfo[] {
  const groupMap = new Map<string, { name: string; tasks: typeof sampleTasks }>();

  for (const task of sampleTasks) {
    const gid = task.groupId || '_ungrouped';
    const gname = task.groupName || 'Ungrouped';
    if (!groupMap.has(gid)) {
      groupMap.set(gid, { name: gname, tasks: [] });
    }
    groupMap.get(gid)!.tasks.push(task);
  }

  const groups: GroupInfo[] = [];
  let zIdx = 0;
  for (const [gid, { name, tasks }] of groupMap) {
    groups.push({ groupId: gid, groupName: name, zIndex: zIdx, tasks });
    zIdx++;
  }
  return groups;
}

// ─── Canvas Text Rendering ──────────────────────────────────────────────────

function createTextSprite(text: string, fontSize: number = 32, color: string = '#e2e8f0'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  const font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;

  canvas.width = Math.ceil(textWidth) + 16;
  canvas.height = fontSize + 16;

  // Re-set font after resize
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 8, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  const aspect = canvas.width / canvas.height;
  const scale = 2.5;
  sprite.scale.set(scale * aspect, scale, 1);

  return sprite;
}

function createGroupLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  const fontSize = 48;
  const font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;

  canvas.width = Math.ceil(textWidth) + 32;
  canvas.height = fontSize + 24;

  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#38bdf8';
  ctx.globalAlpha = 0.7;
  ctx.fillText(text, 16, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  const aspect = canvas.width / canvas.height;
  const scale = 6;
  sprite.scale.set(scale * aspect, scale, 1);

  return sprite;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APPLICATION
// ═══════════════════════════════════════════════════════════════════════════

class Gantt3DApp {
  // Three.js core
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private controls!: OrbitControls;
  private clock = new THREE.Clock();

  // Scene content
  private taskMeshes: TaskMesh[] = [];
  private dependencyLines: THREE.Group = new THREE.Group();
  private labelGroup: THREE.Group = new THREE.Group();
  private particleSystem: THREE.Points | null = null;
  private todayPlane: THREE.Mesh | null = null;
  private gridGroup: THREE.Group = new THREE.Group();

  // State
  private sceneCenter = new THREE.Vector3();
  private hoveredTask: TaskMesh | null = null;
  private selectedTask: TaskMesh | null = null;
  private cameraTarget = new THREE.Vector3();
  private cameraTargetPosition = new THREE.Vector3();
  private isAnimatingCamera = false;
  private cameraMode: 'orbit' | 'fly' = 'orbit';

  // FPS
  private frameCount = 0;
  private fpsTime = 0;
  private fps = 0;

  // Fly mode state
  private flyKeys = { w: false, a: false, s: false, d: false, q: false, e: false };
  private flySpeed = 1.2;

  // Phone controller
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private smoothedBeta = 0;
  private smoothedGamma = 0;
  private phoneBaselineBeta: number | null = null;
  private phoneBaselineGamma: number | null = null;

  // Mouse tracking
  private mouse = new THREE.Vector2(-9999, -9999);
  private raycaster = new THREE.Raycaster();

  // Toggles
  private showLabels = true;
  private showDeps = true;
  private showParticles = true;

  constructor() {
    this.initScene();
    this.initLighting();
    this.initPostProcessing();
    this.initSkybox();
    this.buildGrid();
    this.buildTasks();
    this.buildDependencies();
    this.buildTodayPlane();
    this.buildParticles();
    this.computeSceneCenter();
    this.initControls();
    this.initCameraPresets();
    this.initEventListeners();
    this.connectWebSocket();

    // Jump to orbit preset
    this.animateCameraTo(this.getPreset('orbit'));

    // Dismiss loading screen
    this.showLoadingProgress(100);
    setTimeout(() => {
      document.getElementById('loading-screen')?.classList.add('hidden');
    }, 600);

    // Update task count stat
    const statTasks = document.getElementById('stat-tasks');
    if (statTasks) statTasks.textContent = String(this.taskMeshes.length);

    // Start render loop
    this.animate();
  }

  // ─── Scene Setup ────────────────────────────────────────────────────────

  private initScene(): void {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0e1a, 0.0015);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.5,
      2000
    );
    this.camera.position.set(0, 80, 120);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const container = document.getElementById('canvas-container')!;
    container.appendChild(this.renderer.domElement);
  }

  private initLighting(): void {
    // Ambient — cool blue tint
    const ambient = new THREE.AmbientLight(0x8ecae6, 0.5);
    this.scene.add(ambient);

    // Main directional — top-right, warm
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(100, 150, 80);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 500;
    dirLight.shadow.camera.left = -200;
    dirLight.shadow.camera.right = 200;
    dirLight.shadow.camera.top = 200;
    dirLight.shadow.camera.bottom = -200;
    this.scene.add(dirLight);

    // Fill light — left side, blue tint
    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.3);
    fillLight.position.set(-80, 60, -40);
    this.scene.add(fillLight);

    // Rim light — behind, for silhouette glow
    const rimLight = new THREE.DirectionalLight(0x818cf8, 0.25);
    rimLight.position.set(-50, 30, -100);
    this.scene.add(rimLight);

    // Ground bounce — subtle warm from below
    const bounceLight = new THREE.HemisphereLight(0x1e293b, 0x0f172a, 0.3);
    this.scene.add(bounceLight);
  }

  private initPostProcessing(): void {
    this.composer = new EffectComposer(this.renderer);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.6,    // strength
      0.5,    // radius
      0.7     // threshold
    );
    this.composer.addPass(bloomPass);
  }

  private initSkybox(): void {
    // Gradient sky sphere — dark blue to near-black
    const skyGeo = new THREE.SphereGeometry(800, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x0c1222) },
        bottomColor: { value: new THREE.Color(0x050810) },
        offset: { value: 20 },
        exponent: { value: 0.4 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    // Subtle star field
    const starsGeo = new THREE.BufferGeometry();
    const starPositions: number[] = [];
    const starColors: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 600 + Math.random() * 150;
      starPositions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
      const brightness = 0.3 + Math.random() * 0.7;
      starColors.push(brightness * 0.9, brightness * 0.95, brightness);
    }
    starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    starsGeo.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
    const starsMat = new THREE.PointsMaterial({
      size: 1.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    this.scene.add(new THREE.Points(starsGeo, starsMat));
  }

  // ─── Grid ─────────────────────────────────────────────────────────────

  private buildGrid(): void {
    // Time grid on the ground (Y = -5)
    const groundY = -5;
    const gridMaterial = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.06,
    });

    // X-axis lines (time markers — every 7 days)
    for (let day = -60; day <= 60; day += 7) {
      const x = day * DAY_WIDTH;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, groundY, -20),
        new THREE.Vector3(x, groundY, GROUP_DEPTH * 4),
      ]);
      this.gridGroup.add(new THREE.Line(geo, gridMaterial));
    }

    // Z-axis lines (group separators)
    for (let z = -20; z <= GROUP_DEPTH * 4; z += 10) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-60 * DAY_WIDTH, groundY, z),
        new THREE.Vector3(60 * DAY_WIDTH, groundY, z),
      ]);
      this.gridGroup.add(new THREE.Line(geo, gridMaterial));
    }

    // Month labels on the ground
    const months = [
      { label: 'Feb 2026', day: -59 },
      { label: 'Mar 2026', day: -31 },
      { label: 'Apr 2026', day: 0 },
      { label: 'May 2026', day: 30 },
      { label: 'Jun 2026', day: 61 },
    ];
    for (const m of months) {
      const sprite = createTextSprite(m.label, 28, 'rgba(56, 189, 248, 0.35)');
      sprite.position.set(m.day * DAY_WIDTH, groundY + 0.5, -15);
      this.gridGroup.add(sprite);
    }

    this.scene.add(this.gridGroup);

    // Reflective ground plane
    const groundGeo = new THREE.PlaneGeometry(800, 300);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0a0e1a,
      roughness: 0.9,
      metalness: 0.1,
      transparent: true,
      opacity: 0.6,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, groundY - 0.1, GROUP_DEPTH * 1.5);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  // ─── Task Bar Rendering ───────────────────────────────────────────────

  private buildTasks(): void {
    const groups = buildGroups();

    this.showLoadingProgress(20);

    for (const group of groups) {
      // Filter to leaf tasks (non-parent, non-milestone)
      const leafTasks = group.tasks.filter(t => {
        const isParent = group.tasks.some(c => c.parentId === t.id);
        return !isParent;
      });

      // Group label
      const groupLabel = createGroupLabelSprite(group.groupName);
      const groupZ = group.zIndex * GROUP_DEPTH;
      groupLabel.position.set(-65 * DAY_WIDTH, ROW_SPACING * leafTasks.length / 2, groupZ);
      this.scene.add(groupLabel);

      // Group backdrop plane
      const backdropHeight = leafTasks.length * ROW_SPACING + 4;
      const backdropGeo = new THREE.PlaneGeometry(130 * DAY_WIDTH, backdropHeight);
      const backdropMat = new THREE.MeshBasicMaterial({
        color: hexToColor(this.getGroupColor(group.zIndex)),
        transparent: true,
        opacity: 0.015,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const backdrop = new THREE.Mesh(backdropGeo, backdropMat);
      backdrop.position.set(0, backdropHeight / 2 - 2, groupZ - BAR_DEPTH / 2 - 0.5);
      this.scene.add(backdrop);

      let rowIdx = 0;
      for (const task of leafTasks) {
        this.createTaskBar(task, rowIdx, group.zIndex);
        rowIdx++;
      }
    }

    this.showLoadingProgress(60);
  }

  private getGroupColor(idx: number): string {
    const colors = ['#38bdf8', '#818cf8', '#a78bfa'];
    return colors[idx % colors.length];
  }

  private createTaskBar(task: typeof sampleTasks[0], rowIndex: number, groupIndex: number): void {
    const startDay = dateToDays(task.startDate);
    const endDay = dateToDays(task.endDate);
    const duration = Math.max(endDay - startDay, 0.5);
    const isMilestone = task.isMilestone || false;

    const statusColor = sampleColorMap[task.status || ''] || '#94a3b8';

    const barGroup = new THREE.Group();

    // Position
    const x = (startDay + duration / 2) * DAY_WIDTH;
    const y = rowIndex * ROW_SPACING;
    const z = groupIndex * GROUP_DEPTH;

    let bar: THREE.Mesh;

    if (isMilestone) {
      // Diamond shape for milestones
      const size = 2;
      const geo = new THREE.OctahedronGeometry(size, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: hexToColor(statusColor),
        emissive: hexToColor(statusColor),
        emissiveIntensity: 0.5,
        roughness: 0.15,
        metalness: 0.8,
        transparent: true,
        opacity: 0.95,
      });
      bar = new THREE.Mesh(geo, mat);
      bar.rotation.y = Math.PI / 4;
    } else {
      // Extruded bar with bevel
      const width = duration * DAY_WIDTH;
      const geo = new THREE.BoxGeometry(
        width,
        BAR_HEIGHT,
        BAR_DEPTH,
        1, 1, 1
      );

      const mat = new THREE.MeshStandardMaterial({
        color: hexToColor(statusColor),
        emissive: hexToColor(statusColor),
        emissiveIntensity: 0.15,
        roughness: 0.25,
        metalness: 0.6,
        transparent: true,
        opacity: 0.92,
      });
      bar = new THREE.Mesh(geo, mat);
      bar.castShadow = true;
      bar.receiveShadow = true;

      // Rounded edge frame (wireframe overlay)
      const edgeMat = new THREE.MeshBasicMaterial({
        color: hexToColor(lightenHex(statusColor, 0.3)),
        wireframe: true,
        transparent: true,
        opacity: 0.08,
      });
      const edgeMesh = new THREE.Mesh(geo.clone(), edgeMat);
      barGroup.add(edgeMesh);

      // Edge glow lines (top edges)
      const edgeGeo = new THREE.EdgesGeometry(geo);
      const edgeLineMat = new THREE.LineBasicMaterial({
        color: hexToColor(lightenHex(statusColor, 0.5)),
        transparent: true,
        opacity: 0.2,
      });
      const edgeLines = new THREE.LineSegments(edgeGeo, edgeLineMat);
      barGroup.add(edgeLines);
    }

    barGroup.add(bar);
    barGroup.position.set(x, y, z);

    // Progress fill (inner bar, slightly raised)
    let progressBar: THREE.Mesh | null = null;
    if (!isMilestone && (task.progress || 0) > 0) {
      const width = duration * DAY_WIDTH;
      const progressWidth = width * (task.progress || 0);
      const progressGeo = new THREE.BoxGeometry(
        progressWidth,
        BAR_HEIGHT * 0.7,
        BAR_DEPTH * 0.7,
        1, 1, 1
      );
      const progressMat = new THREE.MeshStandardMaterial({
        color: hexToColor(darkenHex(statusColor, 0.6)),
        emissive: hexToColor(statusColor),
        emissiveIntensity: 0.4,
        roughness: 0.15,
        metalness: 0.8,
        transparent: true,
        opacity: 0.95,
      });
      progressBar = new THREE.Mesh(progressGeo, progressMat);
      progressBar.position.set(
        -(width - progressWidth) / 2,
        0.15,
        0
      );
      barGroup.add(progressBar);
    }

    // Label sprite
    const labelText = task.name.length > 24
      ? task.name.slice(0, 22) + '...'
      : task.name;
    const label = createTextSprite(labelText, 24, '#e2e8f0');
    label.position.set(0, LABEL_OFFSET_Y, 0);
    barGroup.add(label);
    this.labelGroup.add(label);

    this.scene.add(barGroup);

    // Store the mesh reference
    const worldCenter = new THREE.Vector3(x, y, z);
    this.taskMeshes.push({
      id: task.id,
      group: barGroup,
      bar,
      progressBar,
      label,
      task,
      worldCenter,
    });

    // Store task reference on the mesh for raycasting
    (bar as any).__taskMeshRef = this.taskMeshes[this.taskMeshes.length - 1];
  }

  // ─── Dependencies ─────────────────────────────────────────────────────

  private buildDependencies(): void {
    const taskMap = new Map<string, TaskMesh>();
    for (const tm of this.taskMeshes) {
      taskMap.set(tm.id, tm);
    }

    for (const dep of sampleDependencies) {
      const source = taskMap.get(dep.source);
      const target = taskMap.get(dep.target);
      if (!source || !target) continue;

      // Source: right face center
      const sDuration = Math.max(dateToDays(source.task.endDate) - dateToDays(source.task.startDate), 0.5);
      const sRight = new THREE.Vector3(
        source.worldCenter.x + (sDuration * DAY_WIDTH) / 2 + 0.5,
        source.worldCenter.y,
        source.worldCenter.z
      );

      // Target: left face center
      const tDuration = Math.max(dateToDays(target.task.endDate) - dateToDays(target.task.startDate), 0.5);
      const tLeft = new THREE.Vector3(
        target.worldCenter.x - (tDuration * DAY_WIDTH) / 2 - 0.5,
        target.worldCenter.y,
        target.worldCenter.z
      );

      // Create curved path
      const midX = (sRight.x + tLeft.x) / 2;
      const midY = (sRight.y + tLeft.y) / 2 + 3;
      const midZ = (sRight.z + tLeft.z) / 2;

      const curve = new THREE.CatmullRomCurve3([
        sRight,
        new THREE.Vector3(sRight.x + 5, sRight.y + 1, sRight.z),
        new THREE.Vector3(midX, midY, midZ),
        new THREE.Vector3(tLeft.x - 5, tLeft.y + 1, tLeft.z),
        tLeft,
      ]);

      // Tube geometry for the line
      const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.12, 6, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: 0x64748b,
        transparent: true,
        opacity: 0.5,
      });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);

      // Arrow cone at the target end
      const coneGeo = new THREE.ConeGeometry(0.5, 1.5, 6);
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0x94a3b8,
        transparent: true,
        opacity: 0.7,
      });
      const cone = new THREE.Mesh(coneGeo, coneMat);

      // Orient the cone towards the target
      const dir = new THREE.Vector3().subVectors(tLeft, sRight).normalize();
      const axis = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(axis, dir);
      cone.quaternion.copy(quat);
      cone.position.copy(tLeft);

      this.dependencyLines.add(tube);
      this.dependencyLines.add(cone);
    }

    this.scene.add(this.dependencyLines);

    this.showLoadingProgress(75);
  }

  // ─── Today Plane ──────────────────────────────────────────────────────

  private buildTodayPlane(): void {
    const planeHeight = 80;
    const planeDepth = GROUP_DEPTH * 4;
    const geo = new THREE.PlaneGeometry(planeDepth, planeHeight);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(0xff3b3b) },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float time;
        varying vec2 vUv;
        void main() {
          float alpha = 0.08 + 0.03 * sin(time * 2.0 + vUv.y * 6.28);
          float edge = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
          gl_FragColor = vec4(color, alpha * edge);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.todayPlane = new THREE.Mesh(geo, mat);
    this.todayPlane.rotation.y = Math.PI / 2;
    this.todayPlane.position.set(0, planeHeight / 2 - 10, GROUP_DEPTH * 1.5);
    this.scene.add(this.todayPlane);

    // Today label
    const todayLabel = createTextSprite('TODAY', 36, '#ff6b6b');
    todayLabel.position.set(0, planeHeight - 8, -10);
    this.scene.add(todayLabel);

    // Vertical line at today (bright red, thin)
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -5, -20),
      new THREE.Vector3(0, planeHeight - 10, -20),
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xff3b3b,
      transparent: true,
      opacity: 0.5,
    });
    this.scene.add(new THREE.Line(lineGeo, lineMat));
  }

  // ─── Particle System (Today Plane Aura) ───────────────────────────────

  private buildParticles(): void {
    const count = 800;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * 8;      // Near today line
      positions[i3 + 1] = Math.random() * 70 - 5;       // Full height
      positions[i3 + 2] = Math.random() * GROUP_DEPTH * 3 - 20;

      // Red-orange-white gradient
      const t = Math.random();
      colors[i3] = 1.0;
      colors[i3 + 1] = 0.2 + t * 0.5;
      colors[i3 + 2] = 0.2 + t * 0.3;

      sizes[i] = 0.3 + Math.random() * 0.8;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      size: 0.6,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.particleSystem = new THREE.Points(geo, mat);
    this.scene.add(this.particleSystem);

    this.showLoadingProgress(85);
  }

  // ─── Scene Center ─────────────────────────────────────────────────────

  private computeSceneCenter(): void {
    if (this.taskMeshes.length === 0) return;

    let sumX = 0, sumY = 0, sumZ = 0;
    for (const tm of this.taskMeshes) {
      sumX += tm.worldCenter.x;
      sumY += tm.worldCenter.y;
      sumZ += tm.worldCenter.z;
    }
    const n = this.taskMeshes.length;
    this.sceneCenter.set(sumX / n, sumY / n, sumZ / n);
  }

  // ─── Camera Presets ───────────────────────────────────────────────────

  private getPreset(name: string): CameraPreset {
    const sc = this.sceneCenter;
    switch (name) {
      case 'top':
        return {
          position: new THREE.Vector3(sc.x, 180, sc.z + 5),
          lookAt: sc.clone(),
        };
      case 'side':
        return {
          position: new THREE.Vector3(sc.x - 200, sc.y + 20, sc.z),
          lookAt: sc.clone(),
        };
      case 'front':
        return {
          position: new THREE.Vector3(sc.x, sc.y + 10, sc.z + 180),
          lookAt: sc.clone(),
        };
      case 'orbit':
      default:
        return {
          position: new THREE.Vector3(sc.x + 80, sc.y + 70, sc.z + 120),
          lookAt: sc.clone(),
        };
    }
  }

  private animateCameraTo(preset: CameraPreset): void {
    this.cameraTargetPosition.copy(preset.position);
    this.cameraTarget.copy(preset.lookAt);
    this.isAnimatingCamera = true;
    this.cameraMode = 'orbit';

    // Update controls target
    this.controls.target.copy(preset.lookAt);
  }

  private initCameraPresets(): void {
    document.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelector('.preset-btn.active')?.classList.remove('active');
        btn.classList.add('active');
        const preset = this.getPreset(btn.dataset.preset || 'orbit');
        this.animateCameraTo(preset);

        const statCamera = document.getElementById('stat-camera');
        if (statCamera) statCamera.textContent = btn.dataset.preset || 'Orbit';
      });
    });
  }

  // ─── Controls ─────────────────────────────────────────────────────────

  private initControls(): void {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 500;
    this.controls.target.copy(this.sceneCenter);
    this.controls.maxPolarAngle = Math.PI * 0.9;
  }

  // ─── Event Listeners ──────────────────────────────────────────────────

  private initEventListeners(): void {
    // Resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });

    // Mouse move for hover
    this.renderer.domElement.addEventListener('mousemove', (e: MouseEvent) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.handleHover(e);
    });

    // Click for selection
    this.renderer.domElement.addEventListener('click', (e: MouseEvent) => {
      this.handleClick(e);
    });

    // Keyboard for fly mode
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key in this.flyKeys) {
        (this.flyKeys as any)[key] = true;
        this.cameraMode = 'fly';
        this.isAnimatingCamera = false;
      }
      if (key === 'r') {
        this.animateCameraTo(this.getPreset('orbit'));
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key in this.flyKeys) {
        (this.flyKeys as any)[key] = false;
      }
    });

    // Zoom slider
    const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement;
    const zoomValue = document.getElementById('zoom-value');
    zoomSlider?.addEventListener('input', () => {
      const val = parseInt(zoomSlider.value, 10);
      if (zoomValue) zoomValue.textContent = val + '%';
      const fov = 120 - val * 0.6;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    });

    // Toggle labels
    document.getElementById('toggle-labels')?.addEventListener('change', (e) => {
      this.showLabels = (e.target as HTMLInputElement).checked;
      for (const tm of this.taskMeshes) {
        if (tm.label) tm.label.visible = this.showLabels;
      }
    });

    // Toggle dependencies
    document.getElementById('toggle-deps')?.addEventListener('change', (e) => {
      this.showDeps = (e.target as HTMLInputElement).checked;
      this.dependencyLines.visible = this.showDeps;
    });

    // Toggle particles
    document.getElementById('toggle-particles')?.addEventListener('change', (e) => {
      this.showParticles = (e.target as HTMLInputElement).checked;
      if (this.particleSystem) this.particleSystem.visible = this.showParticles;
    });
  }

  // ─── Raycasting / Hover ───────────────────────────────────────────────

  private handleHover(e: MouseEvent): void {
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshes = this.taskMeshes.map(tm => tm.bar);
    const intersects = this.raycaster.intersectObjects(meshes, false);

    // Reset previous hover
    if (this.hoveredTask) {
      const mat = this.hoveredTask.bar.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.15;
      this.renderer.domElement.style.cursor = 'default';
    }

    const tooltip = document.getElementById('task-tooltip')!;

    if (intersects.length > 0) {
      const hit = intersects[0].object as THREE.Mesh;
      const ref = (hit as any).__taskMeshRef as TaskMesh;
      if (ref) {
        this.hoveredTask = ref;
        const mat = ref.bar.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.7;
        this.renderer.domElement.style.cursor = 'pointer';

        // Show tooltip
        this.showTooltip(ref, e.clientX, e.clientY);
        return;
      }
    }

    this.hoveredTask = null;
    tooltip.classList.remove('visible');
  }

  private showTooltip(tm: TaskMesh, mx: number, my: number): void {
    const tooltip = document.getElementById('task-tooltip')!;
    const task = tm.task;
    const statusColor = sampleColorMap[task.status || ''] || '#94a3b8';
    const progress = Math.round((task.progress || 0) * 100);

    tooltip.innerHTML = `
      <div class="tooltip-name">${task.name}</div>
      <div class="tooltip-row">
        <span>Status</span>
        <span class="tooltip-val tooltip-status">
          <span class="tooltip-status-dot" style="background:${statusColor}"></span>
          ${task.status || 'None'}
        </span>
      </div>
      <div class="tooltip-row">
        <span>Assignee</span>
        <span class="tooltip-val">${task.assignee || 'Unassigned'}</span>
      </div>
      <div class="tooltip-row">
        <span>Dates</span>
        <span class="tooltip-val">${formatDateShort(task.startDate)} - ${formatDateShort(task.endDate)}</span>
      </div>
      <div class="tooltip-row">
        <span>Progress</span>
        <span class="tooltip-val">${progress}%</span>
      </div>
      <div class="tooltip-progress">
        <div class="tooltip-progress-fill" style="width:${progress}%;background:${statusColor}"></div>
      </div>
      ${task.groupName ? `<div class="tooltip-row"><span>Group</span><span class="tooltip-val">${task.groupName}</span></div>` : ''}
    `;

    // Position tooltip
    const pad = 16;
    let left = mx + pad;
    let top = my + pad;
    if (left + 280 > window.innerWidth) left = mx - 280 - pad;
    if (top + 200 > window.innerHeight) top = my - 200 - pad;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    tooltip.classList.add('visible');
  }

  private handleClick(_e: MouseEvent): void {
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshes = this.taskMeshes.map(tm => tm.bar);
    const intersects = this.raycaster.intersectObjects(meshes, false);

    // Reset previous selection glow
    if (this.selectedTask) {
      const mat = this.selectedTask.bar.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.15;
    }

    if (intersects.length > 0) {
      const hit = intersects[0].object as THREE.Mesh;
      const ref = (hit as any).__taskMeshRef as TaskMesh;
      if (ref) {
        this.selectedTask = ref;
        const mat = ref.bar.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 1.0;

        // Fly camera towards the selected task
        const target = ref.worldCenter.clone();
        const offset = new THREE.Vector3(15, 10, 25);
        this.cameraTargetPosition.copy(target).add(offset);
        this.cameraTarget.copy(target);
        this.isAnimatingCamera = true;
        this.controls.target.copy(target);
      }
    } else {
      this.selectedTask = null;
    }
  }

  // ─── WebSocket (Phone Controller) ─────────────────────────────────────

  private connectWebSocket(): void {
    const dot = document.getElementById('phone-dot');
    const status = document.getElementById('phone-status');

    const url = 'ws://localhost:8765';
    const qrUrl = document.getElementById('qr-url');
    if (qrUrl) qrUrl.textContent = url;

    // Draw a simple placeholder for the QR (real QR would need a library)
    this.drawQRPlaceholder();

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.wsConnected = true;
        if (dot) dot.className = 'connection-dot connected';
        if (status) status.textContent = 'Connected';
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'orientation') {
            this.handlePhoneOrientation(msg.beta, msg.gamma);
          } else if (msg.type === 'gesture') {
            this.handlePhoneGesture(msg.gesture);
          }
        } catch { /* ignore */ }
      };

      this.ws.onclose = () => {
        this.wsConnected = false;
        if (dot) dot.className = 'connection-dot';
        if (status) status.textContent = 'Disconnected';
        // Auto-reconnect
        setTimeout(() => this.connectWebSocket(), 3000);
      };

      this.ws.onerror = () => {
        if (this.ws) this.ws.close();
      };
    } catch {
      if (dot) dot.className = 'connection-dot';
      if (status) status.textContent = 'No server';
      setTimeout(() => this.connectWebSocket(), 5000);
    }
  }

  private handlePhoneOrientation(beta: number, gamma: number): void {
    // Establish baseline on first reading
    if (this.phoneBaselineBeta === null) {
      this.phoneBaselineBeta = beta;
      this.phoneBaselineGamma = gamma;
    }

    // Relative to baseline
    const relBeta = beta - (this.phoneBaselineBeta || 0);
    const relGamma = gamma - (this.phoneBaselineGamma || 0);

    // Exponential smoothing
    this.smoothedBeta = this.smoothedBeta * SMOOTHING_RETAIN + relBeta * SMOOTHING_RAW;
    this.smoothedGamma = this.smoothedGamma * SMOOTHING_RETAIN + relGamma * SMOOTHING_RAW;

    // Apply to camera orbit — pitch and yaw
    const sensitivity = 0.005;
    const azimuthal = this.controls.getAzimuthalAngle() - this.smoothedGamma * sensitivity;
    const polar = Math.max(0.1, Math.min(Math.PI - 0.1,
      this.controls.getPolarAngle() + this.smoothedBeta * sensitivity));

    // Move orbit controls
    const dist = this.camera.position.distanceTo(this.controls.target);
    const target = this.controls.target;
    this.camera.position.set(
      target.x + dist * Math.sin(polar) * Math.sin(azimuthal),
      target.y + dist * Math.cos(polar),
      target.z + dist * Math.sin(polar) * Math.cos(azimuthal)
    );
    this.camera.lookAt(target);
  }

  private handlePhoneGesture(gesture: string): void {
    switch (gesture) {
      case 'tap':
        // Select nearest visible task
        if (this.hoveredTask) {
          this.handleClick(new MouseEvent('click'));
        }
        break;
      case 'doubletap':
        // Reset camera
        this.phoneBaselineBeta = null;
        this.phoneBaselineGamma = null;
        this.smoothedBeta = 0;
        this.smoothedGamma = 0;
        this.animateCameraTo(this.getPreset('orbit'));
        break;
      case 'swipe-left':
      case 'swipe-right': {
        // Fly forward/backward
        const dir = gesture === 'swipe-right' ? 1 : -1;
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        this.camera.position.addScaledVector(forward, dir * 30);
        break;
      }
    }
  }

  private drawQRPlaceholder(): void {
    const canvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const size = 120;

    // Dark background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, size, size);

    // Draw a stylized grid pattern as a QR placeholder
    ctx.fillStyle = '#38bdf8';
    const cellSize = 6;
    const gridSize = Math.floor(size / cellSize);

    // Corner markers
    const drawCorner = (ox: number, oy: number) => {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const isEdge = x === 0 || x === 6 || y === 0 || y === 6;
          const isInner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          if (isEdge || isInner) {
            ctx.fillRect(
              (ox + x) * cellSize,
              (oy + y) * cellSize,
              cellSize - 1,
              cellSize - 1
            );
          }
        }
      }
    };
    drawCorner(1, 1);
    drawCorner(gridSize - 8, 1);
    drawCorner(1, gridSize - 8);

    // Random data blocks
    for (let i = 0; i < 80; i++) {
      const x = Math.floor(Math.random() * gridSize);
      const y = Math.floor(Math.random() * gridSize);
      ctx.globalAlpha = 0.3 + Math.random() * 0.7;
      ctx.fillRect(x * cellSize, y * cellSize, cellSize - 1, cellSize - 1);
    }
    ctx.globalAlpha = 1;

    // Center label
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(size / 2 - 18, size / 2 - 8, 36, 16);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('WS', size / 2, size / 2 + 4);
  }

  // ─── Loading Progress ─────────────────────────────────────────────────

  private showLoadingProgress(pct: number): void {
    const bar = document.getElementById('loading-bar');
    if (bar) bar.style.width = pct + '%';
  }

  // ─── Fly Mode Update ──────────────────────────────────────────────────

  private updateFlyMode(delta: number): void {
    const speed = this.flySpeed * delta * 60;
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    this.camera.getWorldDirection(forward);
    right.crossVectors(forward, up).normalize();

    if (this.flyKeys.w) this.camera.position.addScaledVector(forward, speed);
    if (this.flyKeys.s) this.camera.position.addScaledVector(forward, -speed);
    if (this.flyKeys.a) this.camera.position.addScaledVector(right, -speed);
    if (this.flyKeys.d) this.camera.position.addScaledVector(right, speed);
    if (this.flyKeys.q) this.camera.position.y -= speed;
    if (this.flyKeys.e) this.camera.position.y += speed;

    // Update orbit controls target to follow camera
    const lookPoint = this.camera.position.clone().add(forward.multiplyScalar(50));
    this.controls.target.copy(lookPoint);
  }

  // ─── Animation Loop ───────────────────────────────────────────────────

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    // FPS counter
    this.frameCount++;
    this.fpsTime += delta;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.frameCount / this.fpsTime);
      this.frameCount = 0;
      this.fpsTime = 0;
      const fpsEl = document.getElementById('stat-fps');
      if (fpsEl) fpsEl.textContent = String(this.fps);
    }

    // Camera animation (smooth lerp)
    if (this.isAnimatingCamera) {
      this.camera.position.lerp(this.cameraTargetPosition, 0.04);
      this.controls.target.lerp(this.cameraTarget, 0.04);

      const dist = this.camera.position.distanceTo(this.cameraTargetPosition);
      if (dist < 0.5) {
        this.isAnimatingCamera = false;
      }
    }

    // Fly mode
    const anyFlyKey = Object.values(this.flyKeys).some(v => v);
    if (anyFlyKey) {
      this.updateFlyMode(delta);
    }

    // Update orbit controls
    this.controls.update();

    // Animate today plane shader
    if (this.todayPlane) {
      const mat = this.todayPlane.material as THREE.ShaderMaterial;
      mat.uniforms.time.value = elapsed;
    }

    // Animate particles (drift upward + wave)
    if (this.particleSystem && this.showParticles) {
      const positions = this.particleSystem.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 1] += delta * (1.5 + Math.sin(elapsed + i) * 0.5);  // Y: drift up
        positions[i] += Math.sin(elapsed * 0.5 + i * 0.1) * delta * 0.3;   // X: wave

        // Reset particles that fly too high
        if (positions[i + 1] > 70) {
          positions[i + 1] = -5;
          positions[i] = (Math.random() - 0.5) * 8;
        }
      }
      this.particleSystem.geometry.attributes.position.needsUpdate = true;
    }

    // Subtle task bar hover animation (floating bob)
    for (const tm of this.taskMeshes) {
      const bob = Math.sin(elapsed * 1.5 + tm.worldCenter.x * 0.1) * 0.08;
      tm.group.position.y = tm.worldCenter.y + bob;
    }

    // Render with post-processing
    this.composer.render();
  };
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

new Gantt3DApp();
