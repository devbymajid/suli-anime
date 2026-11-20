// Suli Anime v1.4 — shared Three.js environment builders (ES module).
// Adapted from the D1 v5 design scenes (game-3d-design-d1-v5/scenes-v5.js):
// same village / home / creator environments, but the builders now fill a
// caller-owned THREE.Scene and return handles, so the game can run a live
// render loop, move the player and follow with a camera. No single-frame
// renders here.
// v1.3: village NPCs are built with their saved appearance (colors).
// v1.4: detailed village — procedural machiya/shop/minka buildings, torii
// gate, stone plaza/paths, props; circle colliders returned to the caller.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { buildCharacter, fitHeight } from './characters-v4.js';
import { getAppearance } from './appearance.js';

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
// v1.4.2: no call sites remain — the labels were removed on the user's
// request; the function is kept (unused) in case they ever return.
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
  // v1.2: name labels must never intercept taps — NPC picking raycasts the
  // character groups, and a sprite in the way would steal the tap.
  sp.raycast = () => {};
  return sp;
}

// ---- v1.4.1 render quality ----
// Stored in localStorage 'suli-quality': 'auto' (default — high on strong
// devices, reduced on weak ones), 'high' (forced) or 'low'. Read at
// renderer creation, so changing the setting reloads the page (antialias
// is fixed when the WebGL context is created and cannot change live).
const QUALITY_KEY = 'suli-quality';
function storedQuality() {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return (v === 'high' || v === 'low' || v === 'auto') ? v : 'auto';
  } catch (e) { return 'auto'; }
}
function setStoredQuality(v) {
  try { localStorage.setItem(QUALITY_KEY, v); } catch (e) { /* private mode — keep the default */ }
}
// Auto: high when the device looks strong. deviceMemory is Chrome-only;
// when it is missing (Safari), cores alone decide — modern iPhones
// report 6.
function autoQuality() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory; // GB, undefined on Safari
  if (mem !== undefined) return (cores >= 6 && mem >= 4) ? 'high' : 'low';
  return cores >= 6 ? 'high' : 'low';
}
function resolveQuality() {
  const s = storedQuality();
  return s === 'auto' ? autoQuality() : s;
}
function qualitySettings() {
  const q = resolveQuality();
  return q === 'high'
    ? { level: 'high', pixelRatio: Math.min(window.devicePixelRatio || 1, 2), antialias: true, shadows: true }
    : { level: 'low', pixelRatio: 1, antialias: false, shadows: false };
}

function baseRenderer(container, w, h, alpha) {
  // v1.4.1: quality comes from the stored setting — high = full pixel
  // ratio + antialias + PCFSoft shadows; low = 1x pixels, no antialias,
  // no shadows. ACES tone mapping + sRGB output apply at both levels
  // (no measurable perf cost, nicer highlights). NOTE: pixelRatio (capped
  // at 2) and antialias were already on in v1 — the visible sharpness gain
  // in this release comes mostly from the closer village camera (main.js)
  // plus the tone mapping; the setting's real job is letting weak phones
  // trade pixels/shadows for speed.
  const q = qualitySettings();
  const renderer = new THREE.WebGLRenderer({ antialias: q.antialias, alpha: !!alpha });
  renderer.setPixelRatio(q.pixelRatio);
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace; // default in r160 — explicit
  if (q.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  container.appendChild(renderer.domElement);
  return renderer;
}
function lights(scene, sky, ground, sunColor, sunI) {
  scene.add(new THREE.HemisphereLight(sky, ground, 0.85));
  const dl = new THREE.DirectionalLight(sunColor || 0xffffff, sunI || 1.1);
  dl.position.set(4, 7, 4); scene.add(dl);
  // v1.4.1: the sun casts shadows when the renderer has shadow maps on
  // (high quality — harmless otherwise: three.js skips shadow rendering
  // entirely when shadowMap.enabled is false). Orthographic frustum
  // covers the whole village/room; the bias values keep the procedural
  // walls acne-free.
  dl.castShadow = true;
  dl.shadow.mapSize.set(1024, 1024);
  dl.shadow.camera.left = -9; dl.shadow.camera.right = 9;
  dl.shadow.camera.top = 9; dl.shadow.camera.bottom = -9;
  dl.shadow.camera.near = 0.5; dl.shadow.camera.far = 30;
  dl.shadow.bias = -0.0005;
  dl.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-5, 3, -2); scene.add(fill);
}
// v1.4.1: shadow flags — every opaque mesh casts + receives; transparent
// meshes (NPC hit cylinders, blob shadow discs) and meshes tagged noCast
// (flat ground planes) receive only. Called at the end of each env
// builder; the renderer flag (high quality) decides whether shadows
// actually render. The player VRM is flagged in main.js (it is added
// after the env builder returns).
function applyShadowFlags(scene) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.receiveShadow = true;
    o.castShadow = !(o.material && o.material.transparent) && !o.userData.noCast;
  });
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

// ---- Procedural canvas textures (v1.4) ----
// Every texture is drawn on a canvas at load — no external files, no
// network. Textures are drawn LIGHT so material.color can tint them
// (a Lambert color multiplies the map).
function canvasTex(w, h, draw, rx, ry) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  if (rx) t.repeat.set(rx, ry || rx);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function seededRnd(seed) {
  let s = seed;
  return function () { s = (s * 16807) % 2147483647; return s / 2147483647; };
}
function rr(x, px, py, w, h, r) { // rounded-rect path
  x.beginPath();
  x.moveTo(px + r, py);
  x.lineTo(px + w - r, py); x.quadraticCurveTo(px + w, py, px + w, py + r);
  x.lineTo(px + w, py + h - r); x.quadraticCurveTo(px + w, py + h, px + w - r, py + h);
  x.lineTo(px + r, py + h); x.quadraticCurveTo(px, py + h, px, py + h - r);
  x.lineTo(px, py + r); x.quadraticCurveTo(px, py, px + r, py);
  x.closePath();
}
function drawCobble(x, w, h) {
  x.fillStyle = '#7d7466'; x.fillRect(0, 0, w, h); // grout
  const n = 4, s = w / n, rnd = seededRnd(11);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const v = 196 + Math.floor(rnd() * 30);
    x.fillStyle = 'rgb(' + v + ',' + (v - 10) + ',' + (v - 32) + ')';
    rr(x, c * s + 3, r * s + 3, s - 6, s - 6, 10); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.10)';
    rr(x, c * s + 7, r * s + 7, s - 14, (s - 14) / 2, 8); x.fill();
  }
}
function drawWoodPlanks(x, w, h) {
  x.fillStyle = '#d9c1a0'; x.fillRect(0, 0, w, h);
  const rnd = seededRnd(23);
  for (let i = 0; i < 4; i++) {
    const px = i * (w / 4);
    x.fillStyle = 'rgba(120,90,55,0.55)';
    x.fillRect(px, 0, 2, h);
    x.fillStyle = 'rgba(120,90,55,0.18)';
    for (let g = 0; g < 5; g++) {
      const gx = px + 4 + rnd() * (w / 4 - 8);
      x.fillRect(gx, rnd() * h * 0.5, 1.5, h * (0.3 + rnd() * 0.5));
    }
  }
}
function drawRoofTiles(x, w, h) {
  x.fillStyle = '#cfc9c4'; x.fillRect(0, 0, w, h);
  const rows = 4, rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    x.fillStyle = 'rgba(90,80,75,0.35)'; x.fillRect(0, y + rh - 3, w, 3);
    for (let c = 0; c < 8; c++) {
      const cx = c * (w / 8) + (r % 2 ? w / 16 : 0);
      x.fillStyle = 'rgba(255,255,255,0.28)';
      x.beginPath(); x.arc(cx, y + rh - 2, w / 18, Math.PI, 0); x.fill();
      x.fillStyle = 'rgba(90,80,75,0.25)';
      x.beginPath(); x.arc(cx, y + rh - 2, w / 18, 0, Math.PI); x.fill();
    }
  }
}
function drawPlaster(x, w, h) {
  x.fillStyle = '#f2ead8'; x.fillRect(0, 0, w, h);
  const rnd = seededRnd(37);
  for (let i = 0; i < 260; i++) {
    x.fillStyle = rnd() > 0.5 ? 'rgba(180,160,120,0.10)' : 'rgba(255,255,255,0.12)';
    x.fillRect(rnd() * w, rnd() * h, 2, 2);
  }
}
function drawLattice(x, w, h) { // shoji paper + dark wood grid (windows)
  x.fillStyle = '#ffeec2'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#5a4230';
  x.fillRect(0, 0, w, 8); x.fillRect(0, h - 8, w, 8);
  x.fillRect(0, 0, 8, h); x.fillRect(w - 8, 0, 8, h);
  for (let i = 1; i < 4; i++) {
    x.fillRect(i * w / 4 - 3, 0, 6, h);
    x.fillRect(0, i * h / 4 - 3, w, 6);
  }
}
function drawShojiDoor(x, w, h) { // sliding door: paper panels + wood frame
  x.fillStyle = '#ffedbe'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#6b4a2f';
  x.fillRect(0, 0, w, 10); x.fillRect(0, h - 10, w, 10);
  x.fillRect(0, 0, 10, h); x.fillRect(w - 10, 0, 10, h);
  x.fillRect(w / 2 - 4, 0, 8, h);
  for (let i = 1; i < 6; i++) x.fillRect(0, i * h / 6 - 3, w, 6);
  x.fillStyle = '#7a5230'; x.fillRect(0, h - h / 6, w, h / 6 - 10); // solid kick panel
}
function drawAwning(x, w, h) { // pink/white stripes
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? '#fdf3e2' : '#e86a8a';
    x.fillRect(i * w / 8, 0, w / 8, h);
  }
  x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(0, h - 10, w, 10);
}
function drawEmblem(x, w, h) { // shop sign: wood board + painted sakura blossom (no text)
  x.fillStyle = '#8b5e3c'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#6b4526'; x.fillRect(0, 0, w, 8); x.fillRect(0, h - 8, w, 8);
  x.fillRect(0, 0, 8, h); x.fillRect(w - 8, 0, 8, h);
  const cx = w / 2, cy = h / 2 - 6, r = 30;
  x.fillStyle = '#f2a0c0';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
    x.beginPath();
    x.ellipse(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.55, r * 0.42, a + Math.PI / 2, 0, Math.PI * 2);
    x.fill();
  }
  x.fillStyle = '#ffd166';
  x.beginPath(); x.arc(cx, cy, 10, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#f2a0c0';
  x.beginPath(); x.arc(cx, h - 26, 7, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.arc(cx - 16, h - 20, 5, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.arc(cx + 16, h - 20, 5, 0, Math.PI * 2); x.fill();
}

// ================= VILLAGE environment (no player avatar) =================
// Walkable plaza is roughly x in [-6.5, 6.5], z in [-6, 6.5]; houses/trees sit
// outside the path. The 3 code-built characters stand in the plaza as NPCs.
function buildVillageEnv(scene) {
  scene.background = new THREE.Color(P.sky);
  scene.fog = new THREE.Fog(P.sky, 16, 34);
  lights(scene, P.sky, P.ground, P.sun, 1.0);
  // v1.4.1: ground planes receive shadows but never cast (flat on the floor)
  const groundPlane = mesh(new THREE.PlaneGeometry(40, 40), mat(P.ground), 0, 0, 0, -Math.PI / 2, 0, 0);
  groundPlane.userData.noCast = true;
  scene.add(groundPlane);
  // v1.4: cobbled main path + central stone plaza (flat ground detail, no colliders)
  const cobblePath = canvasTex(256, 256, drawCobble, 1, 8);
  const pathMesh = mesh(new THREE.PlaneGeometry(2.4, 16),
    new THREE.MeshLambertMaterial({ map: cobblePath, color: 0xd9c9a3 }), 0, 0.03, 1.5, -Math.PI / 2, 0, 0);
  pathMesh.userData.noCast = true;
  scene.add(pathMesh);
  const cobblePlaza = canvasTex(256, 256, drawCobble, 2, 2);
  const plazaMesh = mesh(new THREE.CircleGeometry(2.4, 36),
    new THREE.MeshLambertMaterial({ map: cobblePlaza, color: 0xe8d9b8 }), 0, 0.02, 1.0, -Math.PI / 2, 0, 0);
  plazaMesh.userData.noCast = true;
  scene.add(plazaMesh);

  // ---- v1.4 shared materials (one instance each, reused by every building) ----
  const woodTex = canvasTex(128, 128, drawWoodPlanks);
  const roofTex = canvasTex(128, 128, drawRoofTiles);
  const plasterTex = canvasTex(128, 128, drawPlaster);
  const latticeTex = canvasTex(128, 128, drawLattice);
  const shojiTex = canvasTex(128, 256, drawShojiDoor);
  const awningTex = canvasTex(128, 128, drawAwning);
  const emblemTex = canvasTex(128, 128, drawEmblem);
  const stoneMat = mat(0x9a938a);
  const woodDark = mat(0x6b4a2f);
  const woodMid = mat(0x8b5e3c);
  const latticeMat = new THREE.MeshLambertMaterial({ map: latticeTex, emissive: 0xffdf9e, emissiveIntensity: 0.45, emissiveMap: latticeTex });
  const shojiMat = new THREE.MeshLambertMaterial({ map: shojiTex });
  const awningMat = new THREE.MeshLambertMaterial({ map: awningTex, side: THREE.DoubleSide });
  const emblemMat = new THREE.MeshLambertMaterial({ map: emblemTex });
  const lampMat = mat(0xffe9a8, { emissive: 0xffb84d, emissiveIntensity: 0.7 });
  const vermilion = mat(0xc8432b);
  const darkTrim = mat(0x3a2c22);
  const plasterMat = (c) => new THREE.MeshLambertMaterial({ map: plasterTex, color: c });
  const woodMat = (c) => new THREE.MeshLambertMaterial({ map: woodTex, color: c });
  const roofMat = (c) => new THREE.MeshLambertMaterial({ map: roofTex, color: c });
  const norenMat = (c) => mat(c);
  // v1.4: circle colliders {x, z, r} — the player is pushed out of these in
  // main.js, so nobody walks through a building or a prop. Returned to the caller.
  const colliders = [];
  function addCollider(x, z, r) { colliders.push({ x: x, z: z, r: r }); }

  // Gabled roof: two slanted tile planes + ridge cap + gable-end triangles.
  // w/d = building width/depth, wallTop = y where the walls end, rise = ridge height.
  function gableRoof(g, w, d, wallTop, rise, roofM, gableM) {
    const a = d / 2 + 0.35; // half-depth + eave overhang
    const L = Math.sqrt(a * a + rise * rise);
    const ang = Math.atan2(rise, a);
    const pw = w + 0.7; // width + side overhang
    // front slope (+Z): rotation.x = +ang tilts the +Z edge down
    g.add(mesh(new THREE.BoxGeometry(pw, 0.09, L), roofM, 0, wallTop + rise / 2, a / 2, ang, 0, 0));
    g.add(mesh(new THREE.BoxGeometry(pw, 0.09, L), roofM, 0, wallTop + rise / 2, -a / 2, -ang, 0, 0));
    g.add(mesh(new THREE.BoxGeometry(pw + 0.1, 0.12, 0.24), darkTrim, 0, wallTop + rise + 0.03, 0));
    const tri = new THREE.Shape();
    tri.moveTo(-d / 2 - 0.1, 0); tri.lineTo(d / 2 + 0.1, 0); tri.lineTo(0, rise); tri.closePath();
    const tg = new THREE.ShapeGeometry(tri);
    const t1 = new THREE.Mesh(tg, gableM); t1.position.set(w / 2, wallTop, 0); t1.rotation.y = Math.PI / 2;
    const t2 = new THREE.Mesh(tg, gableM); t2.position.set(-w / 2, wallTop, 0); t2.rotation.y = -Math.PI / 2;
    g.add(t1); g.add(t2);
  }
  // lattice window plane (front +Z face, or rotated for the sides)
  function winPlane(g, w, h, x, y, z, ry) {
    g.add(mesh(new THREE.PlaneGeometry(w, h), latticeMat, x, y, z, 0, ry || 0, 0));
  }
  // noren curtain: 3 short hanging panels above a door
  function noren(g, y, z, color) {
    const m = norenMat(color);
    [-0.26, 0, 0.26].forEach(function (dx, i) {
      g.add(mesh(new THREE.PlaneGeometry(0.24, i === 1 ? 0.34 : 0.28), m, dx, y, z));
    });
  }
  // ---- Design A: 2-story machiya townhouse ----
  function machiya(x, z, ry, s, o) {
    const g = new THREE.Group();
    const W = 2.2, D = 2.0;
    g.add(mesh(new THREE.BoxGeometry(W + 0.15, 0.28, D + 0.15), stoneMat, 0, 0.14, 0)); // stone foundation
    g.add(mesh(new THREE.BoxGeometry(W, 1.5, D), plasterMat(o.wall), 0, 1.03, 0)); // ground floor
    g.add(mesh(new THREE.BoxGeometry(W - 0.15, 1.15, D - 0.15), woodMat(o.wood), 0, 2.355, 0)); // upper floor
    // wood corner posts + ground-floor beam
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
      g.add(mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), woodDark, p[0] * (W / 2 - 0.05), 1.03, p[1] * (D / 2 - 0.05)));
    });
    g.add(mesh(new THREE.BoxGeometry(W + 0.06, 0.12, D + 0.06), woodDark, 0, 1.82, 0));
    gableRoof(g, W, D, 2.93, 0.9, roofMat(o.roof), woodMat(o.wood));
    // door + noren + windows
    g.add(mesh(new THREE.PlaneGeometry(0.8, 1.15), shojiMat, 0, 0.86, D / 2 + 0.02));
    noren(g, 1.6, D / 2 + 0.06, o.noren);
    winPlane(g, 0.6, 0.6, -0.72, 1.15, D / 2 + 0.02);
    winPlane(g, 0.6, 0.6, 0.72, 1.15, D / 2 + 0.02);
    winPlane(g, 0.55, 0.55, -0.6, 2.4, (D - 0.15) / 2 + 0.02);
    winPlane(g, 0.55, 0.55, 0.6, 2.4, (D - 0.15) / 2 + 0.02);
    winPlane(g, 0.55, 0.55, W / 2 + 0.02, 1.15, 0, Math.PI / 2);
    winPlane(g, 0.55, 0.55, -W / 2 - 0.02, 1.15, 0, -Math.PI / 2);
    if (o.balcony) { // upper-floor balcony with railing
      g.add(mesh(new THREE.BoxGeometry(1.6, 0.07, 0.42), woodDark, 0, 1.95, D / 2 + 0.2));
      [-0.72, -0.24, 0.24, 0.72].forEach(function (dx) {
        g.add(mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), woodDark, dx, 2.19, D / 2 + 0.38));
      });
      g.add(mesh(new THREE.BoxGeometry(1.6, 0.05, 0.05), woodDark, 0, 2.42, D / 2 + 0.38));
    }
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.1, 0.5), stoneMat, 0, 0.05, D / 2 + 0.3)); // step stone
    g.position.set(x, 0, z); g.rotation.y = ry; g.scale.setScalar(s || 1);
    scene.add(g);
    addCollider(x, z, 1.5 * (s || 1)); // half-diagonal of the 2.2x2.0 footprint
  }
  // ---- Design B: shop with storefront ----
  function shop(x, z, ry, s, o) {
    const g = new THREE.Group();
    const W = 2.2, D = 2.0;
    g.add(mesh(new THREE.BoxGeometry(W + 0.15, 0.28, D + 0.15), stoneMat, 0, 0.14, 0));
    g.add(mesh(new THREE.BoxGeometry(W, 1.6, D), woodMat(o.wood), 0, 1.08, 0)); // ground floor (wood)
    g.add(mesh(new THREE.BoxGeometry(W - 0.1, 0.85, D - 0.1), plasterMat(o.wall), 0, 2.3, 0)); // low upper floor
    gableRoof(g, W, D, 2.72, 0.7, roofMat(o.roof), plasterMat(o.wall));
    // ridge-end ornaments
    g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), darkTrim, -(W + 0.7) / 2, 3.45, 0));
    g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), darkTrim, (W + 0.7) / 2, 3.45, 0));
    // storefront: dark recessed opening + stall table + crates + fruit
    g.add(mesh(new THREE.PlaneGeometry(1.1, 1.25), darkTrim, -0.3, 0.92, D / 2 + 0.02));
    g.add(mesh(new THREE.BoxGeometry(1.3, 0.08, 0.55), woodDark, -0.3, 0.72, D / 2 + 0.35));
    [[-0.65, 0.45], [0.05, 0.45]].forEach(function (p) {
      g.add(mesh(new THREE.BoxGeometry(0.08, 0.72, 0.45), woodDark, p[0], 0.36, D / 2 + 0.35));
    });
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.26, 0.3), woodMid, -0.6, 0.89, D / 2 + 0.35));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.22, 0.28), woodMid, -0.15, 0.87, D / 2 + 0.35));
    g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), mat(0xe8833a), 0.08, 0.85, D / 2 + 0.35));
    g.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), mat(0x7fb069), 0.22, 0.84, D / 2 + 0.3));
    // striped awning + poles
    g.add(mesh(new THREE.PlaneGeometry(1.9, 0.95), awningMat, -0.3, 1.95, D / 2 + 0.5, -0.5, 0, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), woodDark, -1.15, 0.95, D / 2 + 0.85));
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), woodDark, 0.55, 0.95, D / 2 + 0.85));
    // sign board with painted sakura emblem (symbolic, no text) + door + noren
    g.add(mesh(new THREE.BoxGeometry(0.48, 1.05, 0.07), woodDark, 0.78, 1.15, D / 2 + 0.05));
    g.add(mesh(new THREE.PlaneGeometry(0.42, 0.99), emblemMat, 0.78, 1.15, D / 2 + 0.1));
    noren(g, 1.62, D / 2 + 0.06, o.noren);
    // paper lanterns flanking the storefront + upper windows
    [-1.05, 0.45].forEach(function (dx) {
      g.add(mesh(new THREE.SphereGeometry(0.13, 12, 10), lampMat, dx, 1.85, D / 2 + 0.18));
      g.add(mesh(new THREE.ConeGeometry(0.15, 0.1, 10), darkTrim, dx, 2.0, D / 2 + 0.18));
    });
    winPlane(g, 0.55, 0.5, -0.55, 2.32, (D - 0.1) / 2 + 0.02);
    winPlane(g, 0.55, 0.5, 0.55, 2.32, (D - 0.1) / 2 + 0.02);
    winPlane(g, 0.55, 0.55, W / 2 + 0.02, 1.15, 0, Math.PI / 2);
    g.position.set(x, 0, z); g.rotation.y = ry; g.scale.setScalar(s || 1);
    scene.add(g);
    addCollider(x, z, 1.65 * (s || 1)); // footprint + stall in front
  }
  // ---- Design C: minka cottage (hipped roof, round window) ----
  function minka(x, z, ry, s, o) {
    const g = new THREE.Group();
    const W = 2.3, D = 2.1;
    g.add(mesh(new THREE.BoxGeometry(W + 0.15, 0.3, D + 0.15), stoneMat, 0, 0.15, 0));
    g.add(mesh(new THREE.BoxGeometry(W, 1.5, D), woodMat(o.wood), 0, 1.05, 0));
    g.add(mesh(new THREE.BoxGeometry(W + 0.5, 0.09, D + 0.5), woodDark, 0, 1.83, 0)); // eaves slab
    const hip = mesh(new THREE.ConeGeometry(2.05, 1.15, 4), roofMat(o.roof), 0, 2.45, 0, 0, Math.PI / 4, 0);
    g.add(hip);
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.1, 0.2), darkTrim, 0, 3.02, 0)); // ridge cap
    g.add(mesh(new THREE.PlaneGeometry(0.8, 1.15), shojiMat, -0.45, 0.88, D / 2 + 0.02)); // door
    noren(g, 1.58, D / 2 + 0.06, o.noren);
    g.add(mesh(new THREE.CircleGeometry(0.28, 24), latticeMat, 0.55, 1.2, D / 2 + 0.02)); // round window
    winPlane(g, 0.55, 0.55, W / 2 + 0.02, 1.15, 0, Math.PI / 2);
    winPlane(g, 0.55, 0.55, -W / 2 - 0.02, 1.15, 0, -Math.PI / 2);
    // small wood fence segment beside the cottage
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.8, 0.07), woodDark, W / 2 + 0.7, 0.4, 0.5));
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.8, 0.07), woodDark, W / 2 + 0.7, 0.4, -0.5));
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.07, 1.07), woodDark, W / 2 + 0.7, 0.62, 0));
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.07, 1.07), woodDark, W / 2 + 0.7, 0.32, 0));
    g.position.set(x, 0, z); g.rotation.y = ry; g.scale.setScalar(s || 1);
    scene.add(g);
    addCollider(x, z, 1.55 * (s || 1));
  }
  function tree(x, z, s) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.14, 12), stoneMat, 0, 0.07, 0)); // v1.4: stone base ring
    g.add(mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.1, 8), mat(0x7a5230), 0, 0.55, 0));
    const fol = mat(P.foliage);
    g.add(mesh(new THREE.SphereGeometry(0.95, 12, 10), fol, 0, 1.7, 0));
    g.add(mesh(new THREE.SphereGeometry(0.65, 12, 10), fol, 0.5, 1.3, 0.3));
    g.add(mesh(new THREE.SphereGeometry(0.6, 12, 10), fol, -0.5, 1.35, -0.2));
    g.add(mesh(new THREE.SphereGeometry(0.45, 10, 8), mat(0xf8b8d0), 0.1, 2.2, -0.1)); // v1.4: lighter top puff
    g.position.set(x, 0, z); g.scale.setScalar(s || 1);
    scene.add(g);
  }
  // ---- v1.4 landmark: torii gate at the south end of the path ----
  // The follow camera rides at y≈2.7, so the lower beam (nuki) sits at 2.95
  // and the top lintel at 3.42 — the camera passes underneath, never through.
  function torii(x, z) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.42, 0.18, 0.42), stoneMat, -1.35, 0.09, 0));
    g.add(mesh(new THREE.BoxGeometry(0.42, 0.18, 0.42), stoneMat, 1.35, 0.09, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 3.4, 10), vermilion, -1.35, 1.7, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 3.4, 10), vermilion, 1.35, 1.7, 0));
    g.add(mesh(new THREE.BoxGeometry(3.0, 0.14, 0.16), vermilion, 0, 2.95, 0)); // nuki
    g.add(mesh(new THREE.BoxGeometry(3.6, 0.2, 0.28), vermilion, 0, 3.42, 0)); // kasagi
    g.add(mesh(new THREE.BoxGeometry(3.7, 0.08, 0.32), darkTrim, 0, 3.55, 0)); // top cap
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.34, 0.08), darkTrim, 0, 3.18, 0.12)); // center plaque (no text)
    g.position.set(x, 0, z);
    scene.add(g);
    addCollider(x - 1.35, z, 0.3);
    addCollider(x + 1.35, z, 0.3);
  }
  // ---- v1.4 props (all outside the main walking lanes, all with colliders) ----
  function stoneLantern(x, z) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), stoneMat, 0, 0.06, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.55, 8), stoneMat, 0, 0.4, 0));
    g.add(mesh(new THREE.BoxGeometry(0.42, 0.1, 0.42), stoneMat, 0, 0.72, 0));
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.3, 0.34), lampMat, 0, 0.92, 0));
    g.add(mesh(new THREE.ConeGeometry(0.34, 0.22, 4), stoneMat, 0, 1.18, 0, 0, Math.PI / 4, 0));
    g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), stoneMat, 0, 1.32, 0));
    g.position.set(x, 0, z);
    scene.add(g);
    addCollider(x, z, 0.35);
  }
  function bench(x, z, ry) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(1.5, 0.08, 0.45), woodMid, 0, 0.45, 0));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.45, 0.4), woodDark, -0.62, 0.22, 0));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.45, 0.4), woodDark, 0.62, 0.22, 0));
    g.add(mesh(new THREE.BoxGeometry(1.5, 0.5, 0.06), woodMid, 0, 0.78, -0.2, -0.12, 0, 0));
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(g);
    addCollider(x, z, 0.7);
  }
  function well(x, z) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.6, 14), stoneMat, 0, 0.3, 0));
    g.add(mesh(new THREE.CircleGeometry(0.48, 14), mat(0x2e4a4a), 0, 0.58, 0, -Math.PI / 2, 0, 0)); // dark water
    g.add(mesh(new THREE.BoxGeometry(0.08, 1.35, 0.08), woodDark, -0.58, 0.95, 0));
    g.add(mesh(new THREE.BoxGeometry(0.08, 1.35, 0.08), woodDark, 0.58, 0.95, 0));
    gableRoof(g, 1.5, 1.0, 1.6, 0.4, roofMat(0x8a4a3a), woodMid);
    g.add(mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.16, 10), woodDark, 0.3, 0.68, 0.2)); // bucket on the rim
    g.position.set(x, 0, z);
    scene.add(g);
    addCollider(x, z, 0.75);
  }
  function fenceRun(x1, z1, x2, z2) { // wooden fence along a segment (outside the walk bounds)
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(2, Math.round(len / 1.2) + 1);
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      g.add(mesh(new THREE.BoxGeometry(0.09, 0.9, 0.09), woodDark, (t - 0.5) * len, 0.45, 0));
    }
    g.add(mesh(new THREE.BoxGeometry(len, 0.07, 0.05), woodDark, 0, 0.62, 0));
    g.add(mesh(new THREE.BoxGeometry(len, 0.07, 0.05), woodDark, 0, 0.32, 0));
    g.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
    g.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
    scene.add(g);
  }
  function flowerBed(x, z, ry) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(1.3, 0.18, 0.55), mat(0x5a4230), 0, 0.09, 0));
    const cols = [0xf2a0c0, 0xffffff, 0xffd166, 0xf2a0c0, 0xffd166, 0xffffff];
    cols.forEach(function (c, i) {
      const fx = -0.5 + (i % 3) * 0.5, fz = i < 3 ? -0.13 : 0.13;
      g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), mat(0x5e9a6a), fx, 0.24, fz));
      g.add(mesh(new THREE.SphereGeometry(0.075, 8, 6), mat(c), fx, 0.34, fz));
    });
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(g);
    addCollider(x, z, 0.6);
  }
  function lantern(x, z) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 8), mat(0x5a4230), 0, 0.85, 0));
    const lamp = mat(0xffd27a, { emissive: 0xffb84d, emissiveIntensity: 0.9 });
    g.add(mesh(new THREE.SphereGeometry(0.26, 14, 12), lamp, 0, 1.95, 0));
    g.add(mesh(new THREE.ConeGeometry(0.32, 0.22, 10), mat(0x8a4a3a), 0, 2.22, 0));
    g.position.set(x, 0, z); scene.add(g);
  }
  // v1.4: same 4 footprints/positions/rotations/scales as the v1 houses —
  // only the designs are new (3 distinct designs; the 4th is a machiya variant).
  machiya(-4.4, -4.5, 0.4, 1, { wall: 0xf5e6c8, wood: 0x9a6a42, roof: 0xb85c4a, noren: 0x2e4a7a, balcony: true });
  shop(4.6, -5, -0.3, 1.1, { wall: 0xf7ead2, wood: 0x8b5e3c, roof: 0x5a6a7a, noren: 0xd96c8a });
  minka(5.2, -1, -0.5, 0.85, { wood: 0xa5713f, roof: 0x6a5a4a, noren: 0x5e9a6a });
  machiya(-5, -0.5, 0.5, 0.85, { wall: 0xefe0c2, wood: 0x7a5230, roof: 0x8a4a3a, noren: 0x8a4a6a, balcony: false });
  // v1.4 landmark + props (positions chosen outside the main walking lanes
  // and clear of every NPC hit cylinder; see NOTES.md for the distances)
  torii(0, 5.9);
  stoneLantern(-2.9, 2.9); stoneLantern(3.0, -2.6);
  bench(3.2, 3.4, -0.6); bench(-3.4, 3.6, 0.5);
  well(-4.2, 4.6);
  fenceRun(-6.2, -6.4, 6.2, -6.4); // north edge (outside minZ = -6)
  fenceRun(-6.8, -5.5, -6.8, 6.0); // west edge (outside minX = -6.5)
  fenceRun(6.8, -5.5, 6.8, 6.0); // east edge (outside maxX = 6.5)
  flowerBed(-4.4, -3.2, 0.4); flowerBed(4.6, -3.6, -0.3);
  tree(-3.2, -2.5, 1.1); tree(3.4, -2.8, 1); tree(-4.8, 2.2, 0.9); tree(4.9, 2.4, 1.05); tree(1.8, -6.5, 1.2); tree(-2, -6.8, 1);
  lantern(-1.6, -1.2); lantern(1.7, -0.6); lantern(1.8, 4.2);
  // NPCs: the other 3 default characters, standing in the plaza (static in v1)
  const npcs = [
    { x: -2.1, z: 1.0, ry: 0.5, name: 'سارة', sub: 'المستوى 12', key: 'sara' },
    { x: 1.9, z: -0.4, ry: -0.6, name: 'يوسف', sub: 'المستوى 8', key: 'yusuf' },
    { x: -1.4, z: -3.2, ry: 2.2, name: 'ليان', sub: 'المستوى 15', key: 'layan' },
  ];
  // v1.2: keep the NPC groups so taps can pick them (returns { npcs }).
  // Each group gets an invisible hit cylinder — the characters are small on
  // a phone screen, and a fingertip needs a forgiving target. The cylinder
  // is part of the group, so the same recursive raycast hits meshes and
  // cylinder alike; it renders nothing (opacity 0, no depth write).
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const handles = [];
  for (const p of npcs) {
    const a = buildCharacter(p.key, getAppearance(p.key)); // v1.3: saved colors
    fitHeight(a, 1.37, 0);
    a.position.x = p.x; a.position.z = p.z; a.rotation.y = p.ry;
    a.userData.npcKey = p.key;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.9, 10), hitMat);
    hit.position.y = 0.95;
    a.add(hit);
    scene.add(a);
    scene.add(shadowDisc(p.x, p.z, 0.42));
    // v1.4.2: no name label above NPCs — removed on the user's request
    // ("lvitas"). Name + level still show in the profile sheet.
    handles.push({ key: p.key, group: a });
  }
  // v1.4.1: shadow flags for the whole village (no-op on low quality)
  applyShadowFlags(scene);
  // v1.4: colliders + a stats inventory for tests/NOTES.md
  return {
    npcs: handles,
    colliders: colliders,
    stats: {
      buildings: 4, designs: ['machiya', 'shop', 'minka', 'machiya-variant'],
      torii: true, stoneLanterns: 2, benches: 2, well: 1, fences: 3,
      flowerBeds: 2, trees: 6, poleLanterns: 3, colliders: colliders.length,
    },
  };
}

// ================= HOME environment (no player avatar) =================
// Walkable room floor is roughly x in [-4.6, 4.6], z in [-3.2, 3.6].
function buildHomeEnv(scene) {
  scene.background = new THREE.Color(P.sky);
  lights(scene, 0xfff6e5, P.floor, 0xfff2dd, 1.0);
  const lampLight = new THREE.PointLight(0xffd9a0, 0.9, 8); lampLight.position.set(-2.6, 2.2, 1.2); scene.add(lampLight);
  const floorPlane = mesh(new THREE.PlaneGeometry(16, 12), mat(P.floor), 0, 0, 0.5, -Math.PI / 2, 0, 0);
  floorPlane.userData.noCast = true; // v1.4.1: receives shadows, never casts
  scene.add(floorPlane);
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
  // v1.4.1: shadow flags for the whole room (no-op on low quality)
  applyShadowFlags(scene);
}

export { P, loadVRM, poseVRM, fitVRM, baseRenderer, lights, shadowDisc, nameSprite, buildCreatorEnv, buildVillageEnv, buildHomeEnv, storedQuality, setStoredQuality, resolveQuality, qualitySettings };
