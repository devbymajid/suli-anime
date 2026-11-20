// Suli Anime v1 — shared Three.js environment builders (ES module).
// Adapted from the D1 v5 design scenes (game-3d-design-d1-v5/scenes-v5.js):
// same village / home / creator environments, but the builders now fill a
// caller-owned THREE.Scene and return handles, so the game can run a live
// render loop, move the player and follow with a camera. No single-frame
// renders here.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { buildCharacter, fitHeight } from './characters-v4.js';

// D1 palette («القرية اليابانية») — shared by every screen.
const P = {
  sky: 0xcfeef7, ground: 0x9dc97a, path: 0xd9c9a3, house: 0xf5e6c8, roof: 0xb85c4a,
  foliage: 0xf2a0c0, window: 0xffe9a8, sun: 0xfff2cc, pedestal: 0xe8d9b8,
  floor: 0xf3e7cf, wall: 0xf7ead2, wallSide: 0xefe0c2, wood: 0x8b5e3c,
  sofa: 0xe8a0b4, rug: 0xf2a0c0, rug2: 0xfbd3e0, accent: 0xd96c8a, accent2: 0x5e9a6a,
};

// ---- Real VRM avatar (user-made «Dero» = kaito) ----
// VRM 0.x, KHR_materials_unlit — plain GLTFLoader renders it fully textured.
// Rest pose is a T-pose facing -Z; we pose the arms down.
async function loadVRM(file) {
  const loader = new GLTFLoader();
  const g = await loader.loadAsync('./models/' + file);
  return g.scene;
}
function poseVRM(model) {
  const armL = model.getObjectByName('J_Bip_L_UpperArm');
  const armR = model.getObjectByName('J_Bip_R_UpperArm');
  if (armL) armL.rotation.z = 1.25;   // arms down, slight natural outward angle
  if (armR) armR.rotation.z = -1.25;
  model.updateMatrixWorld(true);
}
// Scale a VRM model to targetHeight, feet on groundY. Returns the scale factor.
function fitVRM(model, targetHeight, groundY) {
  const probe = new THREE.Scene();
  probe.add(model);
  probe.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const h = box.max.y - box.min.y;
  const s = targetHeight / h;
  model.scale.setScalar(s);
  model.position.set(0, groundY - box.min.y * s, 0);
  return s;
}

function mat(color, opts) {
  return new THREE.MeshLambertMaterial(Object.assign({ color: color }, opts || {}));
}
function mesh(geo, material, x, y, z, rx, ry, rz) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x || 0, y || 0, z || 0);
  if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
  return m;
}
// soft oval shadow disc under a standing character
function shadowDisc(x, z, r, y) {
  const d = mesh(new THREE.CircleGeometry(r, 24), mat(0x3a2c1c, { transparent: true, opacity: 0.18 }), x, y || 0.02, z, -Math.PI / 2, 0, 0);
  d.scale.set(1, 0.7, 1);
  return d;
}

// ---- Name label sprite (Arabic text on canvas) ----
// s scales the sprite: the follow camera sits much closer than the v5 static
// shots, so in-game labels use s=0.45 (a full-size label would fill the phone).
function nameSprite(text, sub, s) {
  s = s || 1;
  const c = document.createElement('canvas'); c.width = 288; c.height = sub ? 96 : 72;
  const x = c.getContext('2d');
  const h = c.height;
  x.fillStyle = 'rgba(12,12,20,0.62)';
  const r = 26;
  x.beginPath();
  x.moveTo(r, 4); x.lineTo(284 - r, 4); x.quadraticCurveTo(284, 4, 284, r + 4);
  x.lineTo(284, h - 4 - r); x.quadraticCurveTo(284, h - 4, 284 - r, h - 4);
  x.lineTo(r, h - 4); x.quadraticCurveTo(4, h - 4, 4, h - 4 - r);
  x.lineTo(4, r + 4); x.quadraticCurveTo(4, 4, r, 4); x.closePath(); x.fill();
  x.fillStyle = '#ffffff';
  x.font = '700 34px "Noto Sans Arabic", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 144, sub ? 30 : 38);
  if (sub) { x.fillStyle = '#ffd166'; x.font = '700 24px "Noto Sans Arabic", sans-serif'; x.fillText(sub, 144, 70); }
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(1.7 * s, (sub ? 0.57 : 0.42) * s, 1);
  sp.renderOrder = 10;
  return sp;
}

function baseRenderer(container, w, h, alpha) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !!alpha });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  container.appendChild(renderer.domElement);
  return renderer;
}
function lights(scene, sky, ground, sunColor, sunI) {
  scene.add(new THREE.HemisphereLight(sky, ground, 0.85));
  const dl = new THREE.DirectionalLight(sunColor || 0xffffff, sunI || 1.1);
  dl.position.set(4, 7, 4); scene.add(dl);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-5, 3, -2); scene.add(fill);
}

// ================= CREATOR / HOME PREVIEW: avatar on a pedestal =================
// Fills scene with pedestal + floor disc + floating deco. The avatar is added
// by the caller (VRM kaito or a code-built character), feet at y = 0.22.
function buildCreatorEnv(scene) {
  lights(scene, 0xffffff, P.ground, 0xfff2dd, 1.15);
  const ped = mesh(new THREE.CylinderGeometry(0.6, 0.66, 0.22, 28), mat(P.pedestal), 0, 0.11, 0);
  scene.add(ped);
  const ring = mesh(new THREE.TorusGeometry(0.63, 0.035, 10, 40), mat(P.accent, { emissive: P.accent, emissiveIntensity: 0.35 }), 0, 0.22, 0, Math.PI / 2, 0, 0);
  scene.add(ring);
  scene.add(mesh(new THREE.CircleGeometry(2.6, 40), mat(P.floor, { transparent: true, opacity: 0.85 }), 0, 0.001, 0, -Math.PI / 2, 0, 0));
  const deco = mat(P.accent, { emissive: P.accent, emissiveIntensity: 0.25 });
  const pts = [[-1.5, 1.6, -0.5], [1.5, 0.9, 0.6], [-0.9, 2.1, -1.2]];
  pts.forEach(function (p) { scene.add(mesh(new THREE.OctahedronGeometry(0.09), deco, p[0], p[1], p[2])); });
}

// ================= VILLAGE environment (no player avatar) =================
// Walkable plaza is roughly x in [-6.5, 6.5], z in [-6, 6.5]; houses/trees sit
// outside the path. The 3 code-built characters stand in the plaza as NPCs.
function buildVillageEnv(scene) {
  scene.background = new THREE.Color(P.sky);
  scene.fog = new THREE.Fog(P.sky, 16, 34);
  lights(scene, P.sky, P.ground, P.sun, 1.0);
  scene.add(mesh(new THREE.PlaneGeometry(40, 40), mat(P.ground), 0, 0, 0, -Math.PI / 2, 0, 0));
  scene.add(mesh(new THREE.PlaneGeometry(2.4, 16), mat(P.path), 0, 0.03, 1.5, -Math.PI / 2, 0, 0));
  function house(x, z, ry, s) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(2.2, 1.7, 2.0), mat(P.house), 0, 0.85, 0));
    const roof = mesh(new THREE.ConeGeometry(1.9, 1.2, 4), mat(P.roof), 0, 2.3, 0, 0, Math.PI / 4, 0);
    g.add(roof);
    g.add(mesh(new THREE.BoxGeometry(0.7, 1.0, 0.08), mat(0x4a3423), 0, 0.5, 1.02));
    const win = mat(P.window, { emissive: P.window, emissiveIntensity: 0.15 });
    g.add(mesh(new THREE.PlaneGeometry(0.55, 0.55), win, -0.65, 1.1, 1.01));
    g.add(mesh(new THREE.PlaneGeometry(0.55, 0.55), win, 0.65, 1.1, 1.01));
    g.position.set(x, 0, z); g.rotation.y = ry; g.scale.setScalar(s || 1);
    scene.add(g);
  }
  function tree(x, z, s) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.1, 8), mat(0x7a5230), 0, 0.55, 0));
    const fol = mat(P.foliage);
    g.add(mesh(new THREE.SphereGeometry(0.95, 12, 10), fol, 0, 1.7, 0));
    g.add(mesh(new THREE.SphereGeometry(0.65, 12, 10), fol, 0.5, 1.3, 0.3));
    g.add(mesh(new THREE.SphereGeometry(0.6, 12, 10), fol, -0.5, 1.35, -0.2));
    g.position.set(x, 0, z); g.scale.setScalar(s || 1);
    scene.add(g);
  }
  function lantern(x, z) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 8), mat(0x5a4230), 0, 0.85, 0));
    const lamp = mat(0xffd27a, { emissive: 0xffb84d, emissiveIntensity: 0.9 });
    g.add(mesh(new THREE.SphereGeometry(0.26, 14, 12), lamp, 0, 1.95, 0));
    g.add(mesh(new THREE.ConeGeometry(0.32, 0.22, 10), mat(0x8a4a3a), 0, 2.22, 0));
    g.position.set(x, 0, z); scene.add(g);
  }
  house(-4.4, -4.5, 0.4, 1); house(4.6, -5, -0.3, 1.1); house(5.2, -1, -0.5, 0.85); house(-5, -0.5, 0.5, 0.85);
  tree(-3.2, -2.5, 1.1); tree(3.4, -2.8, 1); tree(-4.8, 2.2, 0.9); tree(4.9, 2.4, 1.05); tree(1.8, -6.5, 1.2); tree(-2, -6.8, 1);
  lantern(-1.6, -1.2); lantern(1.7, -0.6); lantern(1.8, 4.2);
  const pet = mat(0xf9a8d4);
  [[-2.5, 2.6, -1], [2.2, 2.2, 1.5], [0.8, 3.0, -3], [-0.6, 2.4, 2.8]].forEach(function (p) {
    scene.add(mesh(new THREE.OctahedronGeometry(0.12), pet, p[0], p[1], p[2]));
  });
  // NPCs: the other 3 default characters, standing in the plaza (static in v1)
  const npcs = [
    { x: -2.1, z: 1.0, ry: 0.5, name: 'سارة', sub: 'المستوى 12', key: 'sara' },
    { x: 1.9, z: -0.4, ry: -0.6, name: 'يوسف', sub: 'المستوى 8', key: 'yusuf' },
    { x: -1.4, z: -3.2, ry: 2.2, name: 'ليان', sub: 'المستوى 15', key: 'layan' },
  ];
  for (const p of npcs) {
    const a = buildCharacter(p.key);
    fitHeight(a, 1.37, 0);
    a.position.x = p.x; a.position.z = p.z; a.rotation.y = p.ry;
    scene.add(a);
    scene.add(shadowDisc(p.x, p.z, 0.42));
    const sp = nameSprite(p.name, p.sub, 0.45);
    sp.position.set(p.x, 2.15, p.z);
    scene.add(sp);
  }
}

// ================= HOME environment (no player avatar) =================
// Walkable room floor is roughly x in [-4.6, 4.6], z in [-3.2, 3.6].
function buildHomeEnv(scene) {
  scene.background = new THREE.Color(P.sky);
  lights(scene, 0xfff6e5, P.floor, 0xfff2dd, 1.0);
  const lampLight = new THREE.PointLight(0xffd9a0, 0.9, 8); lampLight.position.set(-2.6, 2.2, 1.2); scene.add(lampLight);
  scene.add(mesh(new THREE.PlaneGeometry(16, 12), mat(P.floor), 0, 0, 0.5, -Math.PI / 2, 0, 0));
  scene.add(mesh(new THREE.PlaneGeometry(16, 4.2), mat(P.wall), 0, 2.1, -4, 0, 0, 0));
  const lw = mesh(new THREE.PlaneGeometry(12, 4.2), mat(P.wallSide), -5.5, 2.1, 0.5, 0, Math.PI / 2, 0);
  scene.add(lw);
  const winFrame = mesh(new THREE.BoxGeometry(2.2, 1.8, 0.1), mat(0xffffff), -2.2, 2.5, -3.95);
  scene.add(winFrame);
  const winGlass = mesh(new THREE.PlaneGeometry(1.9, 1.5), mat(P.window, { emissive: P.window, emissiveIntensity: 0.55 }), -2.2, 2.5, -3.89);
  scene.add(winGlass);
  scene.add(mesh(new THREE.BoxGeometry(0.08, 1.5, 0.06), mat(0xffffff), -2.2, 2.5, -3.87));
  scene.add(mesh(new THREE.BoxGeometry(1.9, 0.08, 0.06), mat(0xffffff), -2.2, 2.5, -3.87));
  scene.add(mesh(new THREE.PlaneGeometry(1.2, 0.9), mat(P.accent), 2.0, 2.7, -3.94));
  scene.add(mesh(new THREE.PlaneGeometry(0.9, 0.7), mat(P.accent2), 3.3, 2.4, -3.94));
  const rug = mesh(new THREE.CircleGeometry(1.9, 32), mat(P.rug), 0, 0.02, 0.6, -Math.PI / 2, 0, 0);
  scene.add(rug);
  const rugIn = mesh(new THREE.CircleGeometry(1.3, 32), mat(P.rug2), 0, 0.03, 0.6, -Math.PI / 2, 0, 0);
  scene.add(rugIn);
  const bed = new THREE.Group();
  bed.add(mesh(new THREE.BoxGeometry(1.5, 0.3, 2.4), mat(P.wood), 0, 0.25, 0));
  bed.add(mesh(new THREE.BoxGeometry(1.4, 0.22, 2.3), mat(0xffffff), 0, 0.5, 0));
  bed.add(mesh(new THREE.BoxGeometry(1.4, 0.18, 1.3), mat(P.accent), 0, 0.62, 0.45));
  bed.add(mesh(new THREE.BoxGeometry(1.2, 0.16, 0.5), mat(0xffffff), 0, 0.62, -0.85));
  bed.add(mesh(new THREE.BoxGeometry(1.5, 0.9, 0.12), mat(P.wood), 0, 0.7, -1.2));
  bed.position.set(-3.6, 0, -2.4); bed.rotation.y = 0.06;
  scene.add(bed);
  const sofa = new THREE.Group();
  sofa.add(mesh(new THREE.BoxGeometry(2.4, 0.45, 0.95), mat(P.sofa), 0, 0.35, 0));
  sofa.add(mesh(new THREE.BoxGeometry(2.4, 0.75, 0.28), mat(P.sofa), 0, 0.75, -0.38));
  sofa.add(mesh(new THREE.BoxGeometry(0.28, 0.55, 0.95), mat(P.sofa), -1.15, 0.55, 0));
  sofa.add(mesh(new THREE.BoxGeometry(0.28, 0.55, 0.95), mat(P.sofa), 1.15, 0.55, 0));
  sofa.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.18), mat(P.accent), -0.55, 0.72, -0.2, 0, 0, 0.15));
  sofa.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.18), mat(P.accent2), 0.55, 0.72, -0.2, 0, 0, -0.15));
  sofa.position.set(3.4, 0, -2.2); sofa.rotation.y = -0.5;
  scene.add(sofa);
  const table = new THREE.Group();
  table.add(mesh(new THREE.BoxGeometry(1.5, 0.08, 1.0), mat(P.wood), 0, 0.72, 0));
  [[-0.65, -0.4], [0.65, -0.4], [-0.65, 0.4], [0.65, 0.4]].forEach(function (p) {
    table.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 8), mat(P.wood), p[0], 0.36, p[1]));
  });
  table.add(mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.22, 10), mat(P.accent2), 0.3, 0.87, 0));
  table.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), mat(0x4ade80), 0.3, 1.05, 0));
  table.position.set(1.9, 0, 1.9); table.rotation.y = 0.4;
  scene.add(table);
  const lamp = new THREE.Group();
  lamp.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 8), mat(0x3a3348), 0, 0.85, 0));
  lamp.add(mesh(new THREE.CylinderGeometry(0.3, 0.2, 0.06, 12), mat(0x3a3348), 0, 0.03, 0));
  lamp.add(mesh(new THREE.ConeGeometry(0.34, 0.4, 14, 1, true), mat(0xffe1a8, { emissive: 0xffc46b, emissiveIntensity: 0.7, side: THREE.DoubleSide }), 0, 1.85, 0));
  lamp.position.set(-2.7, 0, 1.4);
  scene.add(lamp);
  const plant = new THREE.Group();
  plant.add(mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.4, 12), mat(P.accent), 0, 0.2, 0));
  plant.add(mesh(new THREE.SphereGeometry(0.5, 12, 10), mat(0x4ade80), 0, 0.85, 0));
  plant.add(mesh(new THREE.SphereGeometry(0.34, 12, 10), mat(0x22c55e), 0.3, 0.6, 0.15));
  plant.position.set(-4.6, 0, 0.6);
  scene.add(plant);
  scene.add(mesh(new THREE.BoxGeometry(1.8, 0.08, 0.35), mat(P.wood), 0.6, 1.9, -3.8));
  scene.add(mesh(new THREE.BoxGeometry(0.28, 0.4, 0.28), mat(P.accent), 0.1, 2.14, -3.8));
  scene.add(mesh(new THREE.BoxGeometry(0.28, 0.34, 0.28), mat(P.accent2), 0.5, 2.11, -3.8));
  scene.add(mesh(new THREE.BoxGeometry(0.28, 0.44, 0.28), mat(0xffffff), 0.9, 2.16, -3.8));
  // small pet cat
  const cat = new THREE.Group();
  cat.add(mesh(new THREE.SphereGeometry(0.16, 12, 10), mat(0xf5f0e6), 0, 0.16, 0));
  cat.add(mesh(new THREE.SphereGeometry(0.12, 12, 10), mat(0xf5f0e6), 0.16, 0.3, 0.05));
  cat.add(mesh(new THREE.ConeGeometry(0.045, 0.09, 4), mat(0xf5f0e6), 0.10, 0.42, 0.05));
  cat.add(mesh(new THREE.ConeGeometry(0.045, 0.09, 4), mat(0xf5f0e6), 0.22, 0.42, 0.05));
  cat.position.set(-1.2, 0.03, 1.9);
  scene.add(cat);
}

export { P, loadVRM, poseVRM, fitVRM, baseRenderer, lights, shadowDisc, nameSprite, buildCreatorEnv, buildVillageEnv, buildHomeEnv };
