import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ASSETS } from './assets';
import { Player } from './player';
import { Npc } from './npc';

declare global {
  interface Window { __frames?: number } // rendered-frame counter, read by headless tests
}

// Low-end mode (?low) skips post-processing - also used by headless tests.
const LOW = new URLSearchParams(location.search).has('low');
const hud = document.getElementById('hud')!;

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

// ---------------------------------------------------------------- renderer --
const renderer = new THREE.WebGLRenderer({ antialias: LOW, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xb8c4d0, 0.006);

const textures = new THREE.TextureLoader();
const [sky, rockGltf] = await Promise.all([
  new HDRLoader().loadAsync(ASSETS.sky),
  new GLTFLoader().loadAsync(ASSETS.rock),
]);
sky.mapping = THREE.EquirectangularReflectionMapping;
scene.background = sky;
scene.environment = sky; // image-based lighting from the same HDRI
scene.environmentIntensity = 0.9;
scene.backgroundIntensity = 1.0;

// -------------------------------------------------------------------- sun --
const sun = new THREE.DirectionalLight(0xfff5e6, 2.2);
sun.position.set(-30, 40, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 150 });
scene.add(sun);

// ----------------------------------------------------------------- ground --
function tiled(url: string, srgb: boolean): THREE.Texture {
  const t = textures.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(80, 80);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({
    map: tiled(ASSETS.ground.color, true),
    normalMap: tiled(ASSETS.ground.normal, false),
    roughnessMap: tiled(ASSETS.ground.roughness, false),
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setTranslation(0, -0.1, 0));

// ------------------------------------------------ rocks (from Blender) ------
const rocks: [number, number, number, number, number][] = [
  // x, y, z, yaw(deg), scale
  [-3.5, -0.15, 1, 25, 1],
  [2.8, -0.1, 0.5, 140, 0.6],
  [9, -0.3, -12, 290, 2.5],
  [-12, -0.25, -16, 70, 3.3],
];
for (const [x, y, z, yaw, s] of rocks) {
  const rock = rockGltf.scene.clone(true);
  rock.position.set(x, y, z);
  rock.rotation.y = THREE.MathUtils.degToRad(yaw);
  rock.scale.setScalar(s);
  rock.updateMatrixWorld(true);
  rock.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = o.receiveShadow = true;
    // Convex-hull collider from the world-space vertices.
    const pos = o.geometry.attributes.position;
    const pts = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).toArray(pts, i * 3);
    }
    const hull = RAPIER.ColliderDesc.convexHull(pts);
    if (hull) world.createCollider(hull);
  });
  scene.add(rock);
}

// ------------------------------------------------- PBR material showcase ----
const showcase: [string, THREE.MeshPhysicalMaterialParameters][] = [
  ['Gold', { color: 0xffc457, metalness: 1, roughness: 0.25 }],
  ['Copper', { color: 0xf2a38a, metalness: 1, roughness: 0.4 }],
  ['Chrome', { color: 0xe6e6e6, metalness: 1, roughness: 0.05 }],
  ['Car paint', { color: 0x8c0508, metalness: 0.4, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }],
  ['Ceramic', { color: 0xebebe6, roughness: 0.3, clearcoat: 0.8 }],
  ['Rubber', { color: 0x0a0a0a, roughness: 0.9 }],
  ['Glass', { color: 0xffffff, roughness: 0, transmission: 1, thickness: 0.6, ior: 1.5 }],
];
const sphereGeo = new THREE.SphereGeometry(0.5, 48, 32);
showcase.forEach(([, params], i) => {
  const m = new THREE.Mesh(sphereGeo, new THREE.MeshPhysicalMaterial(params));
  m.position.set(-3 + i * 1.8, 0.5, -5);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  world.createCollider(RAPIER.ColliderDesc.ball(0.5).setTranslation(m.position.x, 0.5, m.position.z));
});

// --------------------------------------------------- physics crate stack ----
const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b4729, roughness: 0.75 });
const crateGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
const crates: { mesh: THREE.Mesh; body: RAPIER.RigidBody }[] = [];
for (let layer = 0; layer < 4; layer++) {
  for (let i = 0; i < 4 - layer; i++) {
    const x = 5 + (i + layer * 0.5) * 0.82;
    const y = 0.4 + layer * 0.81;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, -3));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.4).setDensity(15), body);
    const mesh = new THREE.Mesh(crateGeo, crateMat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    crates.push({ mesh, body });
  }
}

// ------------------------------------------------------ player and NPC ------
const player = new Player(RAPIER, world, new THREE.Vector3(0, 0, 7), renderer.domElement);
scene.add(player.camera);
const npc = new Npc(new THREE.Vector3(3.2, 0, 2.5));
scene.add(npc.mesh);
world.createCollider(RAPIER.ColliderDesc.capsule(0.575, 0.3).setTranslation(3.2, 0.875, 2.5));
let talkPressed = false;
addEventListener('keydown', (e) => { if (e.code === 'KeyE' && !e.repeat) talkPressed = true; });

const start = document.getElementById('start')!;
start.addEventListener('click', () => renderer.domElement.requestPointerLock());
document.addEventListener('pointerlockchange', () => {
  start.classList.toggle('hidden', document.pointerLockElement === renderer.domElement);
});

// -------------------------------------------------------- post-processing ---
let composer: EffectComposer | null = null;
if (!LOW) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, player.camera));
  const gtao = new GTAOPass(scene, player.camera, innerWidth, innerHeight);
  gtao.blendIntensity = 0.8;
  composer.addPass(gtao);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.15, 0.4, 0.95));
  composer.addPass(new OutputPass()); // tone mapping + sRGB
  composer.addPass(new SMAAPass());
}

addEventListener('resize', () => {
  player.camera.aspect = innerWidth / innerHeight;
  player.camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
});

// -------------------------------------------------------------- main loop ---
const timer = new THREE.Timer();
timer.connect(document); // pauses the delta while the tab is hidden
let frames = 0;
let fpsTime = 0;
let fps = 0;
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const realDt = timer.getDelta();
  const dt = Math.min(realDt, 1 / 20); // clamp so a hitch can't tunnel bodies
  player.update(dt);
  world.timestep = dt;
  world.step();
  for (const { mesh, body } of crates) {
    mesh.position.copy(body.translation());
    mesh.quaternion.copy(body.rotation());
  }
  npc.update(player.position, player.camera, talkPressed);
  talkPressed = false;

  if (composer) composer.render();
  else renderer.render(scene, player.camera);

  frames++;
  fpsTime += realDt;
  if (fpsTime >= 0.5) {
    fps = Math.round(frames / fpsTime);
    frames = 0;
    fpsTime = 0;
    hud.textContent = `${fps} FPS · three.js r${THREE.REVISION} · ${LOW ? 'low' : 'GTAO + bloom + SMAA'}`;
  }
  window.__frames = (window.__frames ?? 0) + 1;
});
