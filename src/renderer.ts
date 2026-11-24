import * as THREE from 'three';
import type { PlayerState, Trap, Pickup } from './types';
import type { Track, TrackFrame } from './track';

type Quality = 'low' | 'medium' | 'high';
interface CarVisual { root: THREE.Group; wheels: THREE.Mesh[]; flames: THREE.Mesh[]; shield: THREE.Mesh; paint: THREE.MeshStandardMaterial; name?: THREE.Sprite; vehicle: string }
interface Particle { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; color: THREE.Color }
const COLORS: Record<string, number> = { speed: 0x36f8ff, nitro: 0xff45dc, super: 0xffd34a, shield: 0x60afff, grip: 0x70ffa8, item: 0xc28bff, oil: 0x735480, ice: 0xa2f5ff, emp: 0x9760ff, block: 0xff4d73, shockwave: 0xffad39, slow: 0xff6b96, orb: 0xd48bff, switch: 0x71ffe4 };
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

/** Procedural scenery and vehicles; simulation remains the source of truth. */
export class GameRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(66, 1, .12, 6500);
  private cars = new Map<string, CarVisual>();
  private traps = new Map<string, THREE.Group>();
  private pickups: { root: THREE.Group; frame: TrackFrame; pickup: Pickup }[] = [];
  private obstacles: { root: THREE.Group; s: number; phase: number }[] = [];
  private scenery = new THREE.Group();
  private hero!: CarVisual;
  private quality: Quality;
  private mode = 0;
  private cameraReady = false;
  private cameraOrientation = new THREE.Quaternion();
  private previousLocal: string | null = null;
  private particles: Particle[] = [];
  private particleGeometry = new THREE.BufferGeometry();
  private particlePositions = new Float32Array(1100 * 3);
  private particleColors = new Float32Array(1100 * 3);
  private particleCursor = 0;
  private randomSeed = 73412;
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement, private track: Track, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.scene.background = new THREE.Color(0x07091c);
    this.scene.fog = new THREE.FogExp2(0x12102d, .00072);
    this.scene.add(new THREE.HemisphereLight(0xa1c6ff, 0x231131, 2.3));
    const sun = new THREE.DirectionalLight(0xd4ddff, 2.8);
    sun.position.set(-120, 240, 90);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xec58ff, 1.7);
    rim.position.set(150, 70, -100);
    this.scene.add(rim);
    this.buildTrack();
    this.buildScenery();
    this.buildPickups();
    this.buildObstacles();
    this.hero = this.makeCar('#38edff', 'vortex');
    this.scene.add(this.hero.root);
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.particleGeometry.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.particleGeometry.setDrawRange(0, 0);
    const points = new THREE.Points(this.particleGeometry, new THREE.PointsMaterial({ size: .29, map: this.particleTexture(), transparent: true, vertexColors: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }));
    points.frustumCulled = false;
    this.scene.add(points);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.setQuality(quality);
  }

  private random(): number { this.randomSeed = (1664525 * this.randomSeed + 1013904223) >>> 0; return this.randomSeed / 4294967296; }

  private particleTexture(): THREE.Texture {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx) { const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16); gradient.addColorStop(0, '#fff'); gradient.addColorStop(.2, '#fff'); gradient.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 32, 32); }
    return new THREE.CanvasTexture(canvas);
  }

  private buildTrack(): void {
    const road: number[] = [], roadColors: number[] = [], neon: number[] = [], neonColors: number[] = [];
    const dark = new THREE.Color(0x171e35), darkAlt = new THREE.Color(0x20253e), cyan = new THREE.Color(0x21e7f3), pink = new THREE.Color(0xff39ba), white = new THREE.Color(0x637689);
    const position = (f: TrackFrame, x: number, y: number) => f.p.clone().addScaledVector(f.right, x).addScaledVector(f.up, y);
    const quad = (out: number[], colors: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color) => {
      for (const p of [a, b, c, a, c, d]) { out.push(p.x, p.y, p.z); colors.push(color.r, color.g, color.b); }
    };
    const strip = (a: TrackFrame, b: TrackFrame, leftA: number, rightA: number, leftB: number, rightB: number, y: number, glow: boolean, color: THREE.Color) => quad(glow ? neon : road, glow ? neonColors : roadColors, position(a, leftA, y), position(b, leftB, y), position(b, rightB, y), position(a, rightA, y), color);
    const ribbons = [this.track.samples, ...this.track.branches.map(branch => branch.samples)];
    for (const samples of ribbons) {
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], b = samples[i + 1];
        if (a.gap || b.gap) continue;
        const wa = a.width / 2, wb = b.width / 2;
        strip(a, b, -wa, wa, -wb, wb, 0, false, i % 8 < 4 ? dark : darkAlt);
        for (const side of [-1, 1]) {
          strip(a, b, side * wa - .12, side * wa + .12, side * wb - .12, side * wb + .12, .12, true, side < 0 ? cyan : pink);
          quad(road, roadColors, position(a, side * wa, 0), position(a, side * wa, -1), position(b, side * wb, -1), position(b, side * wb, 0), dark);
          strip(a, b, side * wa - .34, side * wa + .34, side * wb - .34, side * wb + .34, -.7, true, side < 0 ? cyan : pink);
        }
        if (Math.floor(a.s / 7) % 3 === 0) {
          for (const side of [-1, 1]) strip(a, b, side * wa * .33 - .055, side * wa * .33 + .055, side * wb * .33 - .055, side * wb * .33 + .055, .025, false, white);
        }
        if (a.section.toLowerCase().includes('tunnel')) {
          strip(a, b, -wa - .7, wa + .7, -wb - .7, wb + .7, 7.5, false, dark);
          for (const side of [-1, 1]) {
            quad(road, roadColors, position(a, side * (wa + .6), 0), position(a, side * (wa + .6), 7.5), position(b, side * (wb + .6), 7.5), position(b, side * (wb + .6), 0), dark);
            strip(a, b, side * wa * .7 - .08, side * wa * .7 + .08, side * wb * .7 - .08, side * wb * .7 + .08, 7.35, true, cyan);
          }
        }
      }
    }
    for (const checkpoint of this.track.checkpoints) {
      const a = this.track.sample(checkpoint), b = this.track.sample(checkpoint + .3);
      strip(a, b, -a.width / 2, a.width / 2, -b.width / 2, b.width / 2, .035, true, checkpoint === 0 ? pink : cyan);
    }
    for (let row = 0; row < 2; row++) {
      const a = this.track.sample(row * 1.1 + .5), b = this.track.sample(row * 1.1 + 1.6);
      for (let tile = 0; tile < 14; tile++) if ((tile + row) % 2 === 0) {
        strip(a, b, -a.width / 2 + tile * a.width / 14, -a.width / 2 + (tile + 1) * a.width / 14, -b.width / 2 + tile * b.width / 14, -b.width / 2 + (tile + 1) * b.width / 14, .04, false, new THREE.Color(0xb6c8d7));
      }
    }
    const mesh = (positions: number[], colors: number[], material: THREE.Material) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      this.scene.add(new THREE.Mesh(geometry, material));
    };
    mesh(road, roadColors, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .65, metalness: .5, side: THREE.DoubleSide }));
    mesh(neon, neonColors, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }));
  }

  private buildScenery(): void {
    this.scene.add(this.scenery);
    const bases: THREE.Matrix4[] = [], lights: THREE.Matrix4[] = [], structures: THREE.Matrix4[] = [];
    const helper = new THREE.Object3D();
    const box = (list: THREE.Matrix4[], frame: TrackFrame, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      helper.position.copy(frame.p).addScaledVector(frame.right, x).addScaledVector(frame.up, y).addScaledVector(frame.tangent, z);
      helper.quaternion.copy(frame.rotation); helper.scale.set(sx, sy, sz); helper.updateMatrix(); list.push(helper.matrix.clone());
    };
    for (let s = 0; s < this.track.length; s += 38) {
      const frame = this.track.sample(s);
      if (frame.gap) continue;
      if (Math.floor(s / 38) % 3 === 0 || frame.section.toLowerCase().includes('tunnel')) {
        for (const side of [-1, 1]) {
          box(structures, frame, side * (frame.width / 2 + 1.2), 4.8, 0, .75, 10, .8);
          box(lights, frame, side * (frame.width / 2 + .76), 5.1, 0, .1, 9.3, .14);
        }
        box(structures, frame, 0, 9.7, 0, frame.width + 3, .65, .8);
        box(lights, frame, 0, 9.29, -.12, frame.width + 1.7, .12, .19);
      }
      if (frame.up.y > .25) {
        const height = Math.max(12, frame.p.y + 80);
        helper.position.copy(frame.p).add(new THREE.Vector3(0, -height / 2 - 1, 0));
        helper.quaternion.identity(); helper.scale.set(2.8, height, 3.2); helper.updateMatrix(); bases.push(helper.matrix.clone());
      }
    }
    for (let i = 0; i < 260; i++) {
      const angle = this.random() * Math.PI * 2, radius = 260 + this.random() * 1400;
      const height = 25 + Math.pow(this.random(), 2) * 240;
      helper.position.set(Math.cos(angle) * radius, -110 + height / 2, Math.sin(angle) * radius);
      helper.rotation.set(0, this.random() * Math.PI, 0); helper.scale.set(12 + this.random() * 30, height, 12 + this.random() * 30); helper.updateMatrix(); bases.push(helper.matrix.clone());
      helper.position.y += height / 2 + .5; helper.scale.y = .8; helper.updateMatrix(); lights.push(helper.matrix.clone());
    }
    const addInstances = (matrices: THREE.Matrix4[], material: THREE.Material) => {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix)); mesh.computeBoundingSphere(); this.scenery.add(mesh);
    };
    addInstances(bases, new THREE.MeshStandardMaterial({ color: 0x111a32, roughness: .8, metalness: .6 }));
    addInstances(structures, new THREE.MeshStandardMaterial({ color: 0x303454, roughness: .35, metalness: .8 }));
    addInstances(lights, new THREE.MeshBasicMaterial({ color: 0x5148a8, toneMapped: false }));
    const stars = new Float32Array(1000 * 3);
    for (let i = 0; i < 1000; i++) { const angle = this.random() * Math.PI * 2, height = this.random() * 1800 + 120; stars[i * 3] = Math.cos(angle) * 2600; stars[i * 3 + 1] = height; stars[i * 3 + 2] = Math.sin(angle) * 2600; }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    this.scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x9bafe6, size: 2.3, sizeAttenuation: true })));
    const ground = new THREE.GridHelper(3600, 100, 0x22284d, 0x131d36); ground.position.y = -105; this.scene.add(ground);
    const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(115, 3), new THREE.MeshBasicMaterial({ color: 0x201949 }));
    moon.position.set(-1150, 550, -1800); this.scene.add(moon);
    const halo = new THREE.Mesh(new THREE.RingGeometry(133, 137, 100), new THREE.MeshBasicMaterial({ color: 0x9052e1, side: THREE.DoubleSide, toneMapped: false }));
    halo.position.copy(moon.position); halo.lookAt(0, 0, 0); this.scene.add(halo);
  }

  private buildPickups(): void {
    for (const pickup of this.track.pickups) {
      const frame = this.track.sample(pickup.s);
      const root = new THREE.Group(); root.quaternion.copy(frame.rotation);
      const color = COLORS[pickup.kind] ?? 0xffffff;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(pickup.kind === 'item' ? .65 : .48), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .7, metalness: .6, roughness: .15 }));
      gem.position.y = 1.5; root.add(gem);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.85, .035, 4, 20), new THREE.MeshBasicMaterial({ color, toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = .08; root.add(ring);
      if (pickup.kind !== 'item') {
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .21, side: THREE.DoubleSide, depthWrite: false })); pad.rotation.x = -Math.PI / 2; pad.position.y = .04; root.add(pad);
        for (let j = 0; j < 3; j++) {
          for (const side of [-1, 1]) {
            const arrow = new THREE.Mesh(new THREE.BoxGeometry(.09, .03, .64), new THREE.MeshBasicMaterial({ color, toneMapped: false })); arrow.position.set(side * .21, .07, j * .8 - .8); arrow.rotation.y = side * -.65; root.add(arrow);
          }
        }
      }
      root.position.copy(frame.p).addScaledVector(frame.right, pickup.lateral);
      this.scene.add(root); this.pickups.push({ root, frame, pickup });
    }
  }

  private buildObstacles(): void {
    for (const obstacle of this.track.obstacles) {
      const root = new THREE.Group();
      const core = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.6, 1.2), new THREE.MeshStandardMaterial({ color: 0x29213b, metalness: .8, roughness: .3 })); core.position.y = .8; root.add(core);
      const glowing = new THREE.MeshBasicMaterial({ color: 0xff3c79, toneMapped: false });
      for (const x of [-.82, 0, .82]) { const stripe = new THREE.Mesh(new THREE.BoxGeometry(.11, 1.5, 1.24), glowing); stripe.position.set(x, .8, 0); stripe.rotation.z = -.35; root.add(stripe); }
      this.obstacles.push({ root, s: obstacle.s, phase: obstacle.phase }); this.scene.add(root);
    }
  }

  private makeCar(color: string, vehicle: string, name?: string): CarVisual {
    const root = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, metalness: .67, roughness: .3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b1020, metalness: .6, roughness: .3 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x17324b, emissive: 0x092431, metalness: .85, roughness: .13 });
    const cyan = new THREE.MeshBasicMaterial({ color: 0xb9f7ff, toneMapped: false });
    const rear = new THREE.MeshBasicMaterial({ color: 0xff3370, toneMapped: false });
    const width = vehicle === 'titan' ? 1.13 : vehicle === 'phantom' ? .91 : 1;
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); root.add(mesh); return mesh; };
    // Tapered, faceted hull with a low nose; the cars face local +Z.
    const hull = new THREE.BufferGeometry();
    const vertices = [-1.02,.36,-1.9, 1.02,.36,-1.9, .88,.31,2.05, -.88,.31,2.05, -.94,.83,-1.65, .94,.83,-1.65, .8,.57,1.89, -.8,.57,1.89];
    hull.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); hull.setIndex([0,5,1,0,4,5,1,6,2,1,5,6,2,7,3,2,6,7,3,4,0,3,7,4,4,6,5,4,7,6,3,1,2,3,0,1]); hull.computeVertexNormals();
    add(hull, paint, 0, 0, 0);
    const cabin = add(new THREE.BoxGeometry(1.36, .54, 1.35), glass, 0, .96, -.25); cabin.rotation.x = -.1;
    add(new THREE.BoxGeometry(1.34, .065, .62), paint, 0, 1.25, -.5);
    add(new THREE.BoxGeometry(.2, .04, 1.36), dark, 0, .65, 1.18).rotation.x = .13;
    add(new THREE.BoxGeometry(2.17, .11, .44), dark, 0, .3, 1.82);
    add(new THREE.BoxGeometry(2.18, .12, .49), dark, 0, .37, -1.8);
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(.42, .075, .08), cyan, side * .58, .56, 1.98);
      add(new THREE.BoxGeometry(.65, .075, .07), rear, side * .5, .68, -1.92);
      add(new THREE.BoxGeometry(.1, .1, 2.4), cyan, side * 1.03, .36, 0);
      add(new THREE.BoxGeometry(.2, .5, .13), dark, side * .78, .94, -1.55);
    }
    add(new THREE.BoxGeometry(2.3, .1, .42), vehicle === 'phantom' ? dark : paint, 0, 1.18, -1.63);
    const wheels: THREE.Mesh[] = [];
    for (const side of [-1, 1]) for (const z of [-1.12, 1.17]) {
      const wheel = add(new THREE.CylinderGeometry(.41, .41, .3, 12), dark, side * 1.01, .41, z); wheel.rotation.z = Math.PI / 2; wheels.push(wheel);
      const rim = add(new THREE.CylinderGeometry(.24, .24, .315, 6), paint, side * 1.015, .41, z); rim.rotation.z = Math.PI / 2;
    }
    const flames: THREE.Mesh[] = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x74eaff, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (const side of [-1, 1]) {
      add(new THREE.CylinderGeometry(.13, .13, .23, 8), dark, side * .48, .46, -1.98).rotation.x = Math.PI / 2;
      const flame = add(new THREE.ConeGeometry(.19, 1.6, 6), flameMat, side * .48, .47, -2.4); flame.rotation.x = -Math.PI / 2; flames.push(flame);
    }
    const shield = add(new THREE.IcosahedronGeometry(2.45, 1), new THREE.MeshBasicMaterial({ color: 0x69c7ff, wireframe: true, transparent: true, opacity: .23, depthWrite: false, blending: THREE.AdditiveBlending }), 0, .6, 0); shield.visible = false;
    root.scale.x = width;
    const result: CarVisual = { root, paint, wheels, flames, shield, vehicle };
    if (name) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64; const ctx = canvas.getContext('2d');
      if (ctx) { ctx.font = '600 25px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(7,12,30,.75)'; ctx.fillRect(0, 5, 256, 48); ctx.fillStyle = '#d5f6ff'; ctx.fillText(name.slice(0, 18), 128, 38); }
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true })); sprite.position.y = 2.7; sprite.scale.set(3, .75, 1); root.add(sprite); result.name = sprite;
    }
    return result;
  }

  render(local: PlayerState | null, remotes: PlayerState[], traps: Trap[], timeSeconds: number, dt: number): void {
    if (this.disposed) return;
    const delta = Math.min(Math.max(dt, 0), .1);
    this.hero.root.visible = !local;
    const active = new Set<string>();
    for (const state of local ? [local, ...remotes.filter(remote => remote.id !== local.id)] : remotes) {
      if (!state.connected && state.id !== local?.id) continue;
      active.add(state.id);
      let visual = this.cars.get(state.id);
      if (visual && visual.vehicle !== state.vehicle) { this.destroyObject(visual.root); this.cars.delete(state.id); visual = undefined; }
      if (!visual) { visual = this.makeCar(state.color, state.vehicle, state.id === local?.id ? undefined : state.name); this.cars.set(state.id, visual); this.scene.add(visual.root); }
      visual.root.position.fromArray(state.position); visual.root.quaternion.fromArray(state.rotation);
      visual.paint.color.set(state.color); visual.shield.visible = state.shield; visual.shield.rotation.y = timeSeconds * .7;
      visual.flames.forEach(flame => { flame.visible = state.boosting || state.speed > 7; flame.scale.y = state.boosting ? 1.2 + Math.sin(timeSeconds * 44) * .35 : .19; });
      visual.wheels.forEach(wheel => wheel.rotateY(state.speed * delta / .41));
      if ((state.boosting || state.drifting || state.speed > 75) && this.quality !== 'low') {
        const count = state.boosting ? 5 : state.drifting ? 2 : 1;
        for (let i = 0; i < count; i++) this.emitParticle(visual.root, state.boosting, state.speed, state.drifting);
      }
    }
    for (const [id, visual] of this.cars) if (!active.has(id)) { this.destroyObject(visual.root); this.cars.delete(id); }
    this.updateTraps(traps, timeSeconds);
    for (const item of this.pickups) { const gem = item.root.children[0]; gem.rotation.y = timeSeconds * 1.6; gem.position.y = 1.5 + Math.sin(timeSeconds * 2.8 + item.pickup.s) * .22; }
    for (const obstacle of this.obstacles) { const frame = this.track.sample(obstacle.s); obstacle.root.position.copy(frame.p).addScaledVector(frame.right, Math.sin(timeSeconds * 1.6 + obstacle.phase) * frame.width * .38); obstacle.root.quaternion.copy(frame.rotation); }
    this.updateParticles(delta);
    if (this.previousLocal !== (local?.id ?? null)) { this.cameraReady = false; this.previousLocal = local?.id ?? null; }
    if (local) this.followCamera(local, delta);
    else {
      const frame = this.track.sample(14);
      this.hero.root.position.copy(frame.p); this.hero.root.quaternion.copy(frame.rotation);
      this.hero.flames.forEach(flame => { flame.scale.y = .16; });
      const angle = timeSeconds * .09;
      this.camera.position.copy(frame.p).addScaledVector(frame.right, Math.sin(angle) * 5 + 6).addScaledVector(frame.tangent, Math.cos(angle) * 4 - 8).addScaledVector(frame.up, 3.7);
      this.camera.up.copy(frame.up); this.camera.lookAt(frame.p.clone().addScaledVector(frame.up, .55));
      this.camera.fov = 57; this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }

  private followCamera(state: PlayerState, dt: number): void {
    const quaternion = new THREE.Quaternion().fromArray(state.rotation), position = new THREE.Vector3().fromArray(state.position);
    if (!this.cameraReady) this.cameraOrientation.copy(quaternion);
    else this.cameraOrientation.slerp(quaternion, 1 - Math.exp(-dt * 10));
    const up = UP.clone().applyQuaternion(this.cameraOrientation), forward = FORWARD.clone().applyQuaternion(this.cameraOrientation);
    const distance = this.mode === 1 ? -.6 : this.mode === 2 ? 17 : 8.7 + Math.min(state.speed / 35, 3.2);
    const height = this.mode === 1 ? 1.6 : this.mode === 2 ? 7.8 : 3.4;
    const target = position.clone().addScaledVector(forward, -distance).addScaledVector(up, height);
    if (!this.cameraReady || this.camera.position.distanceTo(target) > 90) this.camera.position.copy(target);
    else this.camera.position.lerp(target, 1 - Math.exp(-dt * (this.mode === 1 ? 28 : 14)));
    this.camera.up.copy(up); this.camera.lookAt(position.addScaledVector(forward, this.mode === 1 ? 25 : 15).addScaledVector(up, 1.05));
    const fov = 66 + Math.min(state.speed / 8, 13) + (state.boosting ? 7 : 0);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, 1 - Math.exp(-dt * 5));
    this.camera.updateProjectionMatrix(); this.cameraReady = true;
    const visual = this.cars.get(state.id); if (visual) visual.root.visible = this.mode !== 1;
  }

  private emitParticle(root: THREE.Group, boost: boolean, speed: number, drifting: boolean): void {
    const maxCount = this.quality === 'high' ? 1100 : 500;
    const p = new THREE.Vector3((this.random() > .5 ? -1 : 1) * (boost ? .48 : 1), .35, -2).applyQuaternion(root.quaternion).add(root.position);
    const v = new THREE.Vector3((this.random() - .5) * 2, this.random(), -Math.max(5, speed * .18)).applyQuaternion(root.quaternion);
    const life = boost ? .45 + this.random() * .3 : .3;
    const particle = { p, v, life, max: life, color: new THREE.Color(boost ? (this.random() > .4 ? 0x33eaff : 0xef46ff) : drifting ? 0xffb75b : 0x60baff) };
    if (this.particles.length < maxCount) this.particles.push(particle);
    else { this.particles[this.particleCursor % maxCount] = particle; this.particleCursor++; }
  }

  private updateParticles(dt: number): void {
    let n = 0;
    for (const particle of this.particles) {
      particle.life -= dt; if (particle.life <= 0) continue;
      particle.p.addScaledVector(particle.v, dt);
      this.particlePositions[n * 3] = particle.p.x; this.particlePositions[n * 3 + 1] = particle.p.y; this.particlePositions[n * 3 + 2] = particle.p.z;
      const intensity = particle.life / particle.max;
      this.particleColors[n * 3] = particle.color.r * intensity; this.particleColors[n * 3 + 1] = particle.color.g * intensity; this.particleColors[n * 3 + 2] = particle.color.b * intensity; n++;
    }
    this.particleGeometry.setDrawRange(0, n);
    this.particleGeometry.attributes.position.needsUpdate = true; this.particleGeometry.attributes.color.needsUpdate = true;
    // Expired slots are retained in the bounded ring to avoid per-frame allocations.
  }

  private updateTraps(states: Trap[], time: number): void {
    const active = new Set<string>();
    for (const state of states) {
      active.add(state.id); let root = this.traps.get(state.id);
      if (!root) {
        root = new THREE.Group();
        const color = COLORS[state.kind] ?? 0xc56bff;
        const groundTrap = ['oil', 'ice', 'slow'].includes(state.kind);
        const geometry = groundTrap ? new THREE.CylinderGeometry(1.9, 1.9, .07, 18) : state.kind === 'block' ? new THREE.BoxGeometry(2.5, 1.5, 1.5) : new THREE.IcosahedronGeometry(.65, 1);
        const core = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: groundTrap ? .16 : .65, transparent: groundTrap, opacity: .85, metalness: .7, roughness: .2 })); core.position.y = groundTrap ? .055 : .8; root.add(core);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(groundTrap ? 1.95 : 1.2, .04, 4, 24), new THREE.MeshBasicMaterial({ color, toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = .1; root.add(ring);
        this.scene.add(root); this.traps.set(state.id, root);
      }
      root.position.fromArray(state.position); root.quaternion.copy(this.track.sample(state.s).rotation);
      if (!['oil', 'ice', 'slow', 'block'].includes(state.kind)) { root.children[0].rotation.y = time * 2; root.children[0].position.y = .9 + Math.sin(time * 4) * .15; }
    }
    for (const [id, root] of this.traps) if (!active.has(id)) { this.destroyObject(root); this.traps.delete(id); }
  }

  setQuality(quality: Quality): void { this.quality = quality; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : quality === 'medium' ? 1.5 : 2)); this.resize(); }
  cycleCamera(): void { this.mode = (this.mode + 1) % 3; this.cameraReady = false; }
  resize(): void { if (this.disposed) return; const width = Math.max(1, this.canvas.clientWidth), height = Math.max(1, this.canvas.clientHeight); this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); }

  private destroyObject(object: THREE.Object3D): void {
    object.removeFromParent();
    const materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>();
    object.traverse(child => { const mesh = child as THREE.Mesh; if (mesh.geometry) geometries.add(mesh.geometry); if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material); });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => { const map = (material as THREE.MeshBasicMaterial).map; map?.dispose(); material.dispose(); });
  }

  dispose(): void { if (this.disposed) return; this.disposed = true; this.resizeObserver.disconnect(); this.destroyObject(this.scene); this.renderer.dispose(); this.cars.clear(); this.traps.clear(); this.particles.length = 0; }
}
