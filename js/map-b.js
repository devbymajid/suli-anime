// Suli Anime v1.5 — map module B «قرية النهر» (River Village).
// One of four switchable big maps. Self-contained ES module: it imports
// only `three`, `./characters-v4.js` and `./appearance.js`; every helper
// (palette, materials, canvas textures, building functions) lives inside.
// v1.7: the MAP export also carries `river` (the NPC crossing contract:
// the river is an x-band [min,max] and `bridge` is the deck-centre point
// the living NPCs route through when crossing banks).
// Adapted from the v1.5 draft env.js (delivery-bigmap-v15/js/env.js) with
// a full re-layout on the B design (option-b-river-village.webp):
//   - the river runs N-S through the MIDDLE of the map (x ~0) and the
//     arched stone bridge at (0,0) is the heart of the village — the ONLY
//     crossing between the two banks (the river is sealed by colliders
//     everywhere else, r=1.85 chain, spacing 2 — no sliver leaks);
//   - 2 shops on each bank (west: fashion + gifts around the market
//     square; east: colors + farm facing the river);
//   - the small market square sits on the WEST bank beside the bridge;
//   - rice fields + hills at the edges, sakura grove (with pond) NW.
// Lights + shadow flags come from the LIVE v1.4.2 js/env.js (the draft's
// lights() had no shadows): sun frustum widened to ±24 for the big map.
// NO nameSprite anywhere (v1.4.2 removed the floating labels); shop signs
// are pictograms only (no readable text); no real anime IP, no copied
// characters or creatures. Ground is flat (y=0) everywhere.
import * as THREE from 'three';
import { buildArticulatedCharacter, fitHeight } from './characters-v4.js';
import { getAppearance } from './appearance.js';

// D1 palette («القرية اليابانية») — shared by every screen.
const P = {
  sky: 0xcfeef7, ground: 0x9dc97a, path: 0xd9c9a3, house: 0xf5e6c8, roof: 0xb85c4a,
  foliage: 0xf2a0c0, window: 0xffe9a8, sun: 0xfff2cc, pedestal: 0xe8d9b8,
  floor: 0xf3e7cf, wall: 0xf7ead2, wallSide: 0xefe0c2, wood: 0x8b5e3c,
  sofa: 0xe8a0b4, rug: 0xf2a0c0, rug2: 0xfbd3e0, accent: 0xd96c8a, accent2: 0x5e9a6a,
};

function mat(color, opts) {
  return new THREE.MeshLambertMaterial(Object.assign({ color: color }, opts || {}));
}
function mesh(geo, material, x, y, z, rx, ry, rz) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x || 0, y || 0, z || 0);
  if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
  return m;
}
// flat ground plane: receives shadows, never casts (v1.4.1 live pattern)
function flat(geo, material, x, y, z) {
  const m = mesh(geo, material, x, y, z, -Math.PI / 2, 0, 0);
  m.userData.noCast = true;
  return m;
}
// soft oval shadow disc under a standing character
function shadowDisc(x, z, r, y) {
  const d = mesh(new THREE.CircleGeometry(r, 24), mat(0x3a2c1c, { transparent: true, opacity: 0.18 }), x, y || 0.02, z, -Math.PI / 2, 0, 0);
  d.scale.set(1, 0.7, 1);
  return d;
}

// ---- lights + shadow flags: taken from the LIVE v1.4.2 js/env.js ----
// (the v1.5 draft's lights() had no shadows and no applyShadowFlags at
// all). Changes vs live, for the big map only: the sun sits farther out
// on the SAME direction (10,17,10) so the whole 40x38 map is in front of
// it, the ortho frustum is widened to ±24 (live: ±9), and far is 60
// (live: 30 — the far map corner is ~40 from the sun). mapSize 1024 and
// both bias values are unchanged from live. The two far corners
// (x-z diagonal beyond ±24) get no shadows — rice fields only, the whole
// village core is inside the frustum.
function lights(scene, sky, ground, sunColor, sunI) {
  scene.add(new THREE.HemisphereLight(sky, ground, 0.85));
  const dl = new THREE.DirectionalLight(sunColor || 0xffffff, sunI || 1.1);
  dl.position.set(10, 17, 10); scene.add(dl);
  dl.castShadow = true;
  dl.shadow.mapSize.set(1024, 1024);
  dl.shadow.camera.left = -24; dl.shadow.camera.right = 24;
  dl.shadow.camera.top = 24; dl.shadow.camera.bottom = -24;
  dl.shadow.camera.near = 0.5; dl.shadow.camera.far = 60;
  dl.shadow.bias = -0.0005;
  dl.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-5, 3, -2); scene.add(fill);
}
// v1.4.1: shadow flags — every opaque mesh casts + receives; transparent
// meshes (NPC hit cylinders, blob shadow discs) and meshes tagged noCast
// (flat ground planes) receive only. Called at the end of buildEnv; the
// renderer flag (high quality) decides whether shadows actually render.
function applyShadowFlags(scene) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.receiveShadow = true;
    o.castShadow = !(o.material && o.material.transparent) && !o.userData.noCast;
  });
}

// ---- Procedural canvas textures (v1.4/v1.5 draft) ----
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
function drawRiceFields(x, w, h) { // terraced paddies: green patches + ridges + water glints
  x.fillStyle = '#7fb069'; x.fillRect(0, 0, w, h);
  const rnd = seededRnd(71);
  const rows = 4, cols = 6;
  const cw = w / cols, rh = h / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const g = 150 + Math.floor(rnd() * 50);
    x.fillStyle = 'rgb(' + (g - 30) + ',' + g + ',' + (g - 70) + ')';
    x.fillRect(c * cw + 2, r * rh + 2, cw - 4, rh - 4);
    if (rnd() > 0.5) { // water glint
      x.fillStyle = 'rgba(200,230,255,0.35)';
      x.fillRect(c * cw + cw * 0.2, r * rh + rh * 0.4, cw * 0.5, 4);
    }
    x.fillStyle = 'rgba(90,70,40,0.5)'; // ridge lines
    x.fillRect(c * cw, r * rh, cw, 2);
    x.fillRect(c * cw, r * rh, 2, rh);
  }
}
function drawAwningNeutral(x, w, h) { // light gray/white stripes — tinted per shop
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? '#f5f2ea' : '#cfc9bd';
    x.fillRect(i * w / 8, 0, w / 8, h);
  }
  x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(0, h - 10, w, 10);
}
function drawEmblemVariant(x, w, h, type) { // shop sign: wood board + symbol (no text)
  x.fillStyle = '#8b5e3c'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#6b4526'; x.fillRect(0, 0, w, 8); x.fillRect(0, h - 8, w, 8);
  x.fillRect(0, 0, 8, h); x.fillRect(w - 8, 0, 8, h);
  const cx = w / 2, cy = h / 2;
  if (type === 'drop') { // paint drop (colors shop)
    x.fillStyle = '#8b5cf6';
    x.beginPath();
    x.moveTo(cx, cy - 34);
    x.bezierCurveTo(cx + 26, cy - 2, cx + 22, cy + 26, cx, cy + 26);
    x.bezierCurveTo(cx - 22, cy + 26, cx - 26, cy - 2, cx, cy - 34);
    x.fill();
    x.fillStyle = 'rgba(255,255,255,0.5)';
    x.beginPath(); x.arc(cx - 8, cy + 8, 6, 0, Math.PI * 2); x.fill();
  } else if (type === 'gift') { // gift box (gifts shop)
    x.fillStyle = '#14b8a6'; x.fillRect(cx - 26, cy - 8, 52, 36);
    x.fillStyle = '#0d9488'; x.fillRect(cx - 30, cy - 20, 60, 14);
    x.fillStyle = '#f472b6'; x.fillRect(cx - 5, cy - 20, 10, 48);
    x.beginPath(); x.arc(cx - 12, cy - 26, 9, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(cx + 12, cy - 26, 9, 0, Math.PI * 2); x.fill();
  } else if (type === 'leaf') { // leaf (farmers' market)
    x.fillStyle = '#5e9a6a';
    x.beginPath();
    x.moveTo(cx, cy - 32);
    x.quadraticCurveTo(cx + 30, cy - 6, cx, cy + 32);
    x.quadraticCurveTo(cx - 30, cy - 6, cx, cy - 32);
    x.fill();
    x.strokeStyle = '#3f7a4a'; x.lineWidth = 4;
    x.beginPath(); x.moveTo(cx, cy - 28); x.lineTo(cx, cy + 30); x.stroke();
  } else { // blossom (default) — sakura, same as the v1.4 shop sign
    const r = 30;
    x.fillStyle = '#f2a0c0';
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
      x.beginPath();
      x.ellipse(cx + Math.cos(a) * r * 0.62, cy - 6 + Math.sin(a) * r * 0.62, r * 0.55, r * 0.42, a + Math.PI / 2, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = '#ffd166';
    x.beginPath(); x.arc(cx, cy - 6, 10, 0, Math.PI * 2); x.fill();
  }
}

// ================= MAP B — «قرية النهر» (River Village) =================
// Layout (bounds x ±20, z -18..20; flat ground y=0):
//   - river N-S through the middle (x -1.5..1.5), stone bridge at (0,0)
//   - market square on the WEST bank by the bridge (plaza at (-6, 0.5))
//     with fashion + gifts shops flanking it and 2 stalls
//   - east bank: colors + farm shops facing the river, small landing disc
//   - residential quarters on both banks (8 houses total)
//   - rice fields at the 4 corners/edges, sakura grove + pond NW, hills
// The player spawns at (-3, 4.8) facing the bridge (ry -0.558): the bridge
// deck + arch are centred in the portrait view on spawn.
function buildEnv(scene) {
  scene.background = new THREE.Color(P.sky);
  scene.fog = new THREE.Fog(P.sky, 30, 75); // v1.5: farther fog for the big map
  lights(scene, P.sky, P.ground, P.sun, 1.0);
  scene.add(flat(new THREE.PlaneGeometry(130, 130), mat(P.ground), 0, 0, 0));
  // ---- ground detail: cobbled bank paths (N-S) + E-W crossing + plaza ----
  const cobbleNS = canvasTex(256, 256, drawCobble, 1, 13);
  const cobblePathMat = new THREE.MeshLambertMaterial({ map: cobbleNS, color: 0xd9c9a3 });
  scene.add(flat(new THREE.PlaneGeometry(2.2, 36), cobblePathMat, -3.4, 0.03, 1)); // west bank path
  scene.add(flat(new THREE.PlaneGeometry(2.2, 36), cobblePathMat, 3.4, 0.03, 1)); // east bank path
  const cobbleEW = canvasTex(256, 256, drawCobble, 5, 1);
  // E-W crossing: hidden under the bridge deck in the middle (deck top
  // y 0.06), visible on both approaches
  scene.add(flat(new THREE.PlaneGeometry(12, 2),
    new THREE.MeshLambertMaterial({ map: cobbleEW, color: 0xd9c9a3 }), 0, 0.035, 0));
  const cobblePlaza = canvasTex(256, 256, drawCobble, 3, 3);
  scene.add(flat(new THREE.CircleGeometry(3.5, 40),
    new THREE.MeshLambertMaterial({ map: cobblePlaza, color: 0xe8d9b8 }), -6, 0.02, 0.5)); // market square (west)
  const cobbleEast = canvasTex(256, 256, drawCobble, 2, 2);
  scene.add(flat(new THREE.CircleGeometry(2.5, 36),
    new THREE.MeshLambertMaterial({ map: cobbleEast, color: 0xe8d9b8 }), 5.5, 0.02, 0)); // east landing
  // dirt paths: to the sakura grove (NW) and to the south fields/farmhouse
  const dirtTex = canvasTex(128, 128, drawPlaster);
  const dirtMat = new THREE.MeshLambertMaterial({ map: dirtTex, color: 0xd9c39a });
  const grovePath = new THREE.Group();
  grovePath.add(flat(new THREE.PlaneGeometry(1.8, 9), dirtMat, 0, 0.025, 0));
  grovePath.position.set(-9.5, 0, -7.5);
  grovePath.rotation.y = 0.5;
  scene.add(grovePath);
  scene.add(flat(new THREE.PlaneGeometry(1.8, 9), dirtMat, -6, 0.025, 9)); // plaza -> farmhouse

  // ---- shared materials (one instance each, reused by every building) ----
  const woodTex = canvasTex(128, 128, drawWoodPlanks);
  const roofTex = canvasTex(128, 128, drawRoofTiles);
  const plasterTex = canvasTex(128, 128, drawPlaster);
  const latticeTex = canvasTex(128, 128, drawLattice);
  const shojiTex = canvasTex(128, 256, drawShojiDoor);
  const awningNeutralTex = canvasTex(128, 128, drawAwningNeutral);
  const stoneMat = mat(0x9a938a);
  const woodDark = mat(0x6b4a2f);
  const woodMid = mat(0x8b5e3c);
  const latticeMat = new THREE.MeshLambertMaterial({ map: latticeTex, emissive: 0xffdf9e, emissiveIntensity: 0.45, emissiveMap: latticeTex });
  const shojiMat = new THREE.MeshLambertMaterial({ map: shojiTex });
  const lampMat = mat(0xffe9a8, { emissive: 0xffb84d, emissiveIntensity: 0.7 });
  const vermilion = mat(0xc8432b);
  const darkTrim = mat(0x3a2c22);
  const plasterMat = (c) => new THREE.MeshLambertMaterial({ map: plasterTex, color: c });
  const woodMat = (c) => new THREE.MeshLambertMaterial({ map: woodTex, color: c });
  const roofMat = (c) => new THREE.MeshLambertMaterial({ map: roofTex, color: c });
  const awningMat = (c) => new THREE.MeshLambertMaterial({ map: awningNeutralTex, color: c, side: THREE.DoubleSide });
  const emblemMat = (t) => new THREE.MeshLambertMaterial({ map: canvasTex(128, 128, (x, w, h) => drawEmblemVariant(x, w, h, t)) });
  const norenMat = (c) => mat(c);
  // invisible hit material (NPCs + shops): raycast hits it, nothing renders.
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  // v1.4: circle colliders {x, z, r} — the player is pushed out of these in
  // main.js, so nobody walks through a building, a prop or the river.
  const colliders = [];
  function addCollider(x, z, r) { colliders.push({ x: x, z: z, r: r }); }

  // Gabled roof: two slanted tile planes + ridge cap + gable-end triangles.
  function gableRoof(g, w, d, wallTop, rise, roofM, gableM) {
    const a = d / 2 + 0.35;
    const L = Math.sqrt(a * a + rise * rise);
    const ang = Math.atan2(rise, a);
    const pw = w + 0.7;
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
  function winPlane(g, w, h, x, y, z, ry) {
    g.add(mesh(new THREE.PlaneGeometry(w, h), latticeMat, x, y, z, 0, ry || 0, 0));
  }
  function noren(g, y, z, color) { // 3 short hanging panels above a door
    const m = norenMat(color);
    [-0.26, 0, 0.26].forEach(function (dx, i) {
      g.add(mesh(new THREE.PlaneGeometry(0.24, i === 1 ? 0.34 : 0.28), m, dx, y, z));
    });
  }
  // ---- Design A: 2-story machiya townhouse (v1.4, unchanged) ----
  function machiya(x, z, ry, s, o) {
    const g = new THREE.Group();
    const W = 2.2, D = 2.0;
    g.add(mesh(new THREE.BoxGeometry(W + 0.15, 0.28, D + 0.15), stoneMat, 0, 0.14, 0));
    g.add(mesh(new THREE.BoxGeometry(W, 1.5, D), plasterMat(o.wall), 0, 1.03, 0));
    g.add(mesh(new THREE.BoxGeometry(W - 0.15, 1.15, D - 0.15), woodMat(o.wood), 0, 2.355, 0));
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
      g.add(mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), woodDark, p[0] * (W / 2 - 0.05), 1.03, p[1] * (D / 2 - 0.05)));
    });
    g.add(mesh(new THREE.BoxGeometry(W + 0.06, 0.12, D + 0.06), woodDark, 0, 1.82, 0));
    gableRoof(g, W, D, 2.93, 0.9, roofMat(o.roof), woodMat(o.wood));
    g.add(mesh(new THREE.PlaneGeometry(0.8, 1.15), shojiMat, 0, 0.86, D / 2 + 0.02));
    noren(g, 1.6, D / 2 + 0.06, o.noren);
    winPlane(g, 0.6, 0.6, -0.72, 1.15, D / 2 + 0.02);
    winPlane(g, 0.6, 0.6, 0.72, 1.15, D / 2 + 0.02);
    winPlane(g, 0.55, 0.55, -0.6, 2.4, (D - 0.15) / 2 + 0.02);
    winPlane(g, 0.55, 0.55, 0.6, 2.4, (D - 0.15) / 2 + 0.02);
    winPlane(g, 0.55, 0.55, W / 2 + 0.02, 1.15, 0, Math.PI / 2);
    winPlane(g, 0.55, 0.55, -W / 2 - 0.02, 1.15, 0, -Math.PI / 2);
    if (o.balcony) {
      g.add(mesh(new THREE.BoxGeometry(1.6, 0.07, 0.42), woodDark, 0, 1.95, D / 2 + 0.2));
      [-0.72, -0.24, 0.24, 0.72].forEach(function (dx) {
        g.add(mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), woodDark, dx, 2.19, D / 2 + 0.38));
      });
      g.add(mesh(new THREE.BoxGeometry(1.6, 0.05, 0.05), woodDark, 0, 2.42, D / 2 + 0.38));
    }
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.1, 0.5), stoneMat, 0, 0.05, D / 2 + 0.3));
    g.position.set(x, 0, z); g.rotation.y = ry; g.scale.setScalar(s || 1);
    scene.add(g);
    addCollider(x, z, 1.5 * (s || 1));
  }
  // ---- Design B: shop with storefront (v1.5: per-shop awning + emblem + tap target) ----
  // o.shopId makes the building tappable: the group gets userData.shopId and
  // an invisible hit cylinder, and the handle is returned to the caller.
  const shops = [];
  function shop(x, z, ry, s, o) {
    const g = new THREE.Group();
    const W = 2.2, D = 2.0;
    g.add(mesh(new THREE.BoxGeometry(W + 0.15, 0.28, D + 0.15), stoneMat, 0, 0.14, 0));
    g.add(mesh(new THREE.BoxGeometry(W, 1.6, D), woodMat(o.wood), 0, 1.08, 0));
    g.add(mesh(new THREE.BoxGeometry(W - 0.1, 0.85, D - 0.1), plasterMat(o.wall), 0, 2.3, 0));
    gableRoof(g, W, D, 2.72, 0.7, roofMat(o.roof), plasterMat(o.wall));
    g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), darkTrim, -(W + 0.7) / 2, 3.45, 0));
    g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), darkTrim, (W + 0.7) / 2, 3.45, 0));
    g.add(mesh(new THREE.PlaneGeometry(1.1, 1.25), darkTrim, -0.3, 0.92, D / 2 + 0.02));
    g.add(mesh(new THREE.BoxGeometry(1.3, 0.08, 0.55), woodDark, -0.3, 0.72, D / 2 + 0.35));
    [[-0.65, 0.45], [0.05, 0.45]].forEach(function (p) {
      g.add(mesh(new THREE.BoxGeometry(0.08, 0.72, 0.45), woodDark, p[0], 0.36, D / 2 + 0.35));
    });
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.26, 0.3), woodMid, -0.6, 0.89, D / 2 + 0.35));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.22, 0.28), woodMid, -0.15, 0.87, D / 2 + 0.35));
    g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), mat(0xe8833a), 0.08, 0.85, D / 2 + 0.35));
    g.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), mat(0x7fb069), 0.22, 0.84, D / 2 + 0.3));
    g.add(mesh(new THREE.PlaneGeometry(1.9, 0.95), awningMat(o.awning), -0.3, 1.95, D / 2 + 0.5, -0.5, 0, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), woodDark, -1.15, 0.95, D / 2 + 0.85));
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), woodDark, 0.55, 0.95, D / 2 + 0.85));
    g.add(mesh(new THREE.BoxGeometry(0.48, 1.05, 0.07), woodDark, 0.78, 1.15, D / 2 + 0.05));
    g.add(mesh(new THREE.PlaneGeometry(0.42, 0.99), emblemMat(o.emblem), 0.78, 1.15, D / 2 + 0.1));
    noren(g, 1.62, D / 2 + 0.06, o.noren);
    [-1.05, 0.45].forEach(function (dx) {
      g.add(mesh(new THREE.SphereGeometry(0.13, 12, 10), lampMat, dx, 1.85, D / 2 + 0.18));
      g.add(mesh(new THREE.ConeGeometry(0.15, 0.1, 10), darkTrim, dx, 2.0, D / 2 + 0.18));
    });
    winPlane(g, 0.55, 0.5, -0.55, 2.32, (D - 0.1) / 2 + 0.02);
    winPlane(g, 0.55, 0.5, 0.55, 2.32, (D - 0.1) / 2 + 0.02);
    winPlane(g, 0.55, 0.55, W / 2 + 0.02, 1.15, 0, Math.PI / 2);
    g.userData.shopId = o.shopId;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3.4, 10), hitMat);
    hit.position.y = 1.7;
    g.add(hit);
    g.position.set(x, 0, z); g.rotation.y = ry; g.scale.setScalar(s || 1);
    scene.add(g);
    addCollider(x, z, 1.65 * (s || 1));
    shops.push({ id: o.shopId, group: g });
  }
  // ---- Design C: minka cottage (v1.4, unchanged) ----
  function minka(x, z, ry, s, o) {
    const g = new THREE.Group();
    const W = 2.3, D = 2.1;
    g.add(mesh(new THREE.BoxGeometry(W + 0.15, 0.3, D + 0.15), stoneMat, 0, 0.15, 0));
    g.add(mesh(new THREE.BoxGeometry(W, 1.5, D), woodMat(o.wood), 0, 1.05, 0));
    g.add(mesh(new THREE.BoxGeometry(W + 0.5, 0.09, D + 0.5), woodDark, 0, 1.83, 0));
    const hip = mesh(new THREE.ConeGeometry(2.05, 1.15, 4), roofMat(o.roof), 0, 2.45, 0, 0, Math.PI / 4, 0);
    g.add(hip);
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.1, 0.2), darkTrim, 0, 3.02, 0));
    g.add(mesh(new THREE.PlaneGeometry(0.8, 1.15), shojiMat, -0.45, 0.88, D / 2 + 0.02));
    noren(g, 1.58, D / 2 + 0.06, o.noren);
    g.add(mesh(new THREE.CircleGeometry(0.28, 24), latticeMat, 0.55, 1.2, D / 2 + 0.02));
    winPlane(g, 0.55, 0.55, W / 2 + 0.02, 1.15, 0, Math.PI / 2);
    winPlane(g, 0.55, 0.55, -W / 2 - 0.02, 1.15, 0, -Math.PI / 2);
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.8, 0.07), woodDark, W / 2 + 0.7, 0.4, 0.5));
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.8, 0.07), woodDark, W / 2 + 0.7, 0.4, -0.5));
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.07, 1.07), woodDark, W / 2 + 0.7, 0.62, 0));
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.07, 1.07), woodDark, W / 2 + 0.7, 0.32, 0));
    g.position.set(x, 0, z); g.rotation.y = ry; g.scale.setScalar(s || 1);
    scene.add(g);
    addCollider(x, z, 1.55 * (s || 1));
  }
  // ---- Design D (v1.5): simple 1-story house — fewer meshes, for the
  // far districts (north-west, farmhouse). Same family, plainer build.
  function house(x, z, ry, s, o) {
    const g = new THREE.Group();
    const W = 2.0, D = 1.8;
    g.add(mesh(new THREE.BoxGeometry(W + 0.12, 0.26, D + 0.12), stoneMat, 0, 0.13, 0));
    g.add(mesh(new THREE.BoxGeometry(W, 1.45, D), plasterMat(o.wall), 0, 0.99, 0));
    gableRoof(g, W, D, 1.71, 0.75, roofMat(o.roof), woodMat(o.wood));
    g.add(mesh(new THREE.PlaneGeometry(0.75, 1.1), shojiMat, -0.3, 0.83, D / 2 + 0.02));
    noren(g, 1.52, D / 2 + 0.06, o.noren);
    winPlane(g, 0.55, 0.55, 0.55, 1.1, D / 2 + 0.02);
    winPlane(g, 0.55, 0.55, W / 2 + 0.02, 1.1, 0, Math.PI / 2);
    winPlane(g, 0.55, 0.55, -W / 2 - 0.02, 1.1, 0, -Math.PI / 2);
    g.add(mesh(new THREE.BoxGeometry(0.85, 0.09, 0.45), stoneMat, -0.3, 0.05, D / 2 + 0.28));
    g.position.set(x, 0, z); g.rotation.y = ry; g.scale.setScalar(s || 1);
    scene.add(g);
    addCollider(x, z, 1.35 * (s || 1));
  }
  function tree(x, z, s) { // sakura (v1.4, unchanged)
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.14, 12), stoneMat, 0, 0.07, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.1, 8), mat(0x7a5230), 0, 0.55, 0));
    const fol = mat(P.foliage);
    g.add(mesh(new THREE.SphereGeometry(0.95, 12, 10), fol, 0, 1.7, 0));
    g.add(mesh(new THREE.SphereGeometry(0.65, 12, 10), fol, 0.5, 1.3, 0.3));
    g.add(mesh(new THREE.SphereGeometry(0.6, 12, 10), fol, -0.5, 1.35, -0.2));
    g.add(mesh(new THREE.SphereGeometry(0.45, 10, 8), mat(0xf8b8d0), 0.1, 2.2, -0.1));
    g.position.set(x, 0, z); g.scale.setScalar(s || 1);
    scene.add(g);
  }
  function greenTree(x, z, s) { // v1.5: lush green tree (Ghibli hills) — 4 meshes
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.15, 0.22, 1.2, 8), mat(0x6b4a2f), 0, 0.6, 0));
    g.add(mesh(new THREE.SphereGeometry(1.0, 10, 8), mat(0x5e9a6a), 0, 1.85, 0));
    g.add(mesh(new THREE.SphereGeometry(0.7, 10, 8), mat(0x6fae76), 0.55, 1.45, 0.25));
    g.add(mesh(new THREE.SphereGeometry(0.65, 10, 8), mat(0x4e8a58), -0.55, 1.5, -0.2));
    g.position.set(x, 0, z); g.scale.setScalar(s || 1);
    scene.add(g);
  }
  // ---- torii gate (v1.4): the follow camera rides at y≈2.7, so the lower
  // beam (nuki) sits at 2.95 and the top lintel at 3.42 — the camera passes
  // underneath, never through. v1.5 map B: one on each bridge approach,
  // rotated 90° (ry=π/2) so the opening faces the crossing (posts at
  // z ±1.35, the player walks between them along X).
  function torii(x, z, ry) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.42, 0.18, 0.42), stoneMat, -1.35, 0.09, 0));
    g.add(mesh(new THREE.BoxGeometry(0.42, 0.18, 0.42), stoneMat, 1.35, 0.09, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 3.4, 10), vermilion, -1.35, 1.7, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 3.4, 10), vermilion, 1.35, 1.7, 0));
    g.add(mesh(new THREE.BoxGeometry(3.0, 0.14, 0.16), vermilion, 0, 2.95, 0));
    g.add(mesh(new THREE.BoxGeometry(3.6, 0.2, 0.28), vermilion, 0, 3.42, 0));
    g.add(mesh(new THREE.BoxGeometry(3.7, 0.08, 0.32), darkTrim, 0, 3.55, 0));
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.34, 0.08), darkTrim, 0, 3.18, 0.12));
    g.position.set(x, 0, z); g.rotation.y = ry || 0;
    scene.add(g);
    const c = Math.cos(ry || 0), s = Math.sin(ry || 0);
    addCollider(x + 1.35 * c, z - 1.35 * s, 0.3);
    addCollider(x - 1.35 * c, z + 1.35 * s, 0.3);
  }
  function stoneLantern(x, z) { // v1.4, unchanged
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
  function bench(x, z, ry) { // v1.4, unchanged
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(1.5, 0.08, 0.45), woodMid, 0, 0.45, 0));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.45, 0.4), woodDark, -0.62, 0.22, 0));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.45, 0.4), woodDark, 0.62, 0.22, 0));
    g.add(mesh(new THREE.BoxGeometry(1.5, 0.5, 0.06), woodMid, 0, 0.78, -0.2, -0.12, 0, 0));
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(g);
    addCollider(x, z, 0.7);
  }
  function well(x, z) { // v1.4, unchanged
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.6, 14), stoneMat, 0, 0.3, 0));
    g.add(mesh(new THREE.CircleGeometry(0.48, 14), mat(0x2e4a4a), 0, 0.58, 0, -Math.PI / 2, 0, 0));
    g.add(mesh(new THREE.BoxGeometry(0.08, 1.35, 0.08), woodDark, -0.58, 0.95, 0));
    g.add(mesh(new THREE.BoxGeometry(0.08, 1.35, 0.08), woodDark, 0.58, 0.95, 0));
    gableRoof(g, 1.5, 1.0, 1.6, 0.4, roofMat(0x8a4a3a), woodMid);
    g.add(mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.16, 10), woodDark, 0.3, 0.68, 0.2));
    g.position.set(x, 0, z);
    scene.add(g);
    addCollider(x, z, 0.75);
  }
  function fenceRun(x1, z1, x2, z2) { // v1.4, unchanged (outside the walk bounds)
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
  function flowerBed(x, z, ry) { // v1.5: slimmer (6 blooms, no stems) — 7 meshes
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(1.3, 0.18, 0.55), mat(0x5a4230), 0, 0.09, 0));
    const cols = [0xf2a0c0, 0xffffff, 0xffd166, 0xf2a0c0, 0xffd166, 0xffffff];
    cols.forEach(function (c, i) {
      const fx = -0.5 + (i % 3) * 0.5, fz = i < 3 ? -0.13 : 0.13;
      g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(c), fx, 0.24, fz));
    });
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(g);
    addCollider(x, z, 0.6);
  }
  function lantern(x, z) { // v1.4 pole lantern, unchanged (passable, v1 behavior)
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 8), mat(0x5a4230), 0, 0.85, 0));
    const lamp = mat(0xffd27a, { emissive: 0xffb84d, emissiveIntensity: 0.9 });
    g.add(mesh(new THREE.SphereGeometry(0.26, 14, 12), lamp, 0, 1.95, 0));
    g.add(mesh(new THREE.ConeGeometry(0.32, 0.22, 10), mat(0x8a4a3a), 0, 2.22, 0));
    g.position.set(x, 0, z); scene.add(g);
  }
  // ---- v1.5: open-air market stall (plaza) — striped awning + crates ----
  function stall(x, z, ry, awningColor) {
    const g = new THREE.Group();
    [[-0.8, -0.5], [0.8, -0.5], [-0.8, 0.5], [0.8, 0.5]].forEach(function (p) {
      g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 8), woodDark, p[0], 0.95, p[1]));
    });
    g.add(mesh(new THREE.PlaneGeometry(2.0, 1.4), awningMat(awningColor), 0, 1.95, 0, -Math.PI / 2 + 0.12, 0, 0));
    g.add(mesh(new THREE.BoxGeometry(1.6, 0.08, 0.7), woodDark, 0, 0.75, 0));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.75, 0.6), woodDark, -0.7, 0.37, 0));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.75, 0.6), woodDark, 0.7, 0.37, 0));
    g.add(mesh(new THREE.BoxGeometry(0.36, 0.26, 0.32), woodMid, -0.45, 0.92, 0));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.22, 0.28), woodMid, 0.3, 0.9, 0.05));
    g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), mat(0xe8833a), 0.55, 0.87, -0.1));
    g.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), mat(0xc0392b), 0.05, 0.87, -0.15));
    g.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), mat(0x7fb069), -0.1, 0.86, 0.18));
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(g);
    addCollider(x, z, 0.8);
  }
  // ---- v1.5: wisteria trellis (night-street reference, daytime) ----
  // A wooden frame with hanging purple clusters; the player walks UNDER it
  // (beam at y 2.3) — only the two posts have colliders, like the torii.
  function wisteria(x, z, ry) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const px = [1.1, -1.1].map(function (dx) { return { x: x + dx * c, z: z - dx * s }; });
    px.forEach(function (p) {
      scene.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.3, 8), woodDark, p.x, 1.15, p.z));
      addCollider(p.x, p.z, 0.25);
    });
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(2.5, 0.1, 0.3), woodDark, 0, 2.32, 0));
    g.add(mesh(new THREE.BoxGeometry(2.5, 0.06, 0.9), mat(0x5e9a6a), 0, 2.42, 0)); // vine mat on top
    const purp = mat(0x9b7ede), purp2 = mat(0xb9a3e8);
    [-0.9, -0.45, 0, 0.45, 0.9].forEach(function (dx, i) {
      g.add(mesh(new THREE.SphereGeometry(0.17, 8, 6), i % 2 ? purp2 : purp, dx, 2.05 - (i % 2) * 0.12, 0.1));
      g.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), i % 2 ? purp : purp2, dx + 0.08, 1.82, -0.08));
    });
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(g);
  }
  // ---- v1.5 map B: river + stone bridge (CENTRE — the heart of the map) ----
  // The river is a flat water strip N-S through the middle (x -1.5..1.5,
  // z -18..20). The player cannot enter it: a chain of r=1.85 colliders
  // (spacing 2) seals the strip except at the bridge deck (z -1.15..1.15
  // at x=0 — the deck itself spans z -2.5..2.5, so the whole open corridor
  // is on stone). r=1.85 (not the draft's 1.6) closes the sliver leak: at
  // the midpoint between two chain circles the coverage reaches
  // |x| < sqrt(1.85^2 - 1^2) = 1.56 > 1.5 (the water's edge). The deck is
  // flat (the walk code has no height), but the two side facades carry a
  // real arch cutout, so from the banks it reads as an arched stone
  // bridge. The river runs the full map length, so there is no way around
  // its ends either (bounds clamp at z -18 / 20).
  function riverAndBridge() {
    const waterMat = mat(0x7ec8e3, { transparent: true, opacity: 0.85 });
    scene.add(flat(new THREE.PlaneGeometry(3, 38), waterMat, 0, 0.015, 1));
    // banks: sandy strips on both sides of the water
    scene.add(flat(new THREE.PlaneGeometry(0.8, 38), mat(0xd9c9a3), -1.9, 0.012, 1));
    scene.add(flat(new THREE.PlaneGeometry(0.8, 38), mat(0xd9c9a3), 1.9, 0.012, 1));
    // lily pads (kept clear of the bridge zone z -3..3)
    [[-0.6, -10, 0.22], [0.7, -6, 0.28], [-0.8, 7, 0.2], [0.6, 11, 0.26], [-0.5, -14, 0.24], [0.8, 15, 0.22], [-0.7, 17.5, 0.2], [0.5, -17, 0.22]].forEach(function (p) {
      scene.add(flat(new THREE.CircleGeometry(p[2], 12), mat(0x5e9a6a), p[0], 0.03, p[1]));
    });
    [[-2.3, -8], [2.3, 9], [-2.2, 14], [2.2, -13]].forEach(function (p) {
      const r = mesh(new THREE.SphereGeometry(0.3, 8, 6), stoneMat, p[0], 0.08, p[1]);
      r.scale.y = 0.55;
      scene.add(r);
    });
    // deck: flat stone slab (top y 0.06 — feet stay on the ground plane)
    const deck = mesh(new THREE.BoxGeometry(4.4, 0.06, 5), stoneMat, 0, 0.03, 0);
    scene.add(deck);
    const deckTop = flat(new THREE.PlaneGeometry(4.0, 4.6),
      new THREE.MeshLambertMaterial({ map: canvasTex(256, 256, drawCobble, 2, 2), color: 0xe8d9b8 }), 0, 0.065, 0);
    scene.add(deckTop);
    // arch facades on the north/south faces (semicircular cutout)
    const archShape = new THREE.Shape();
    archShape.moveTo(-2.2, -0.5); archShape.lineTo(2.2, -0.5);
    archShape.lineTo(2.2, 0.7); archShape.lineTo(-2.2, 0.7); archShape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-1, -0.5);
    hole.absarc(0, -0.5, 1.0, Math.PI, 0, true);
    hole.lineTo(-1, -0.5);
    archShape.holes.push(hole);
    const archGeo = new THREE.ShapeGeometry(archShape);
    const archMat = new THREE.MeshLambertMaterial({ color: 0x9a938a, side: THREE.DoubleSide });
    const f1 = new THREE.Mesh(archGeo, archMat); f1.position.set(0, 0, -2.5); scene.add(f1);
    const f2 = new THREE.Mesh(archGeo, archMat); f2.position.set(0, 0, 2.5); scene.add(f2);
    // parapets just outside the deck edges (over the water — the player
    // can never reach them, so no colliders needed)
    [[-2.68], [2.68]].forEach(function (pz) {
      scene.add(mesh(new THREE.BoxGeometry(4.4, 0.35, 0.16), stoneMat, 0, 0.24, pz[0]));
    });
    [[-2.2, -2.68], [2.2, -2.68], [-2.2, 2.68], [2.2, 2.68]].forEach(function (p) {
      scene.add(mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), stoneMat, p[0], 0.3, p[1]));
    });
    // river colliders: chain along x=0 (r 1.85, spacing 2) with the bridge
    // zone (z -2..2) open.
    for (let z = -17; z <= 19; z += 2) {
      if (z >= -2 && z <= 2) continue;
      addCollider(0, z, 1.85);
    }
  }
  // ---- v1.5: rice fields (4 corners/edges) — one canvas texture, flat planes ----
  function riceFields() {
    const tex = canvasTex(512, 256, drawRiceFields);
    const riceMat = new THREE.MeshLambertMaterial({ map: tex, color: 0xffffff });
    scene.add(flat(new THREE.PlaneGeometry(12, 7), riceMat, -14, 0.01, 15.5)); // south-west
    scene.add(flat(new THREE.PlaneGeometry(12, 7), riceMat, 14, 0.01, 15.5)); // south-east
    scene.add(flat(new THREE.PlaneGeometry(12, 5), riceMat, -14, 0.01, -15.5)); // north-west
    scene.add(flat(new THREE.PlaneGeometry(12, 5), riceMat, 14, 0.01, -15.5)); // north-east
  }
  // ---- v1.5: hills + distant houses (outside the bounds, background) ----
  function hills() {
    const cols = [0x7fb069, 0x6a9a5a];
    [[-32, -22, 16, 8], [30, -26, 18, 9], [-35, 12, 15, 7], [33, 18, 16, 8], [0, -40, 20, 10], [-10, 40, 18, 8]].forEach(function (h, i) {
      scene.add(mesh(new THREE.ConeGeometry(h[2], h[3], 7), mat(cols[i % 2]), h[0], h[3] / 2 - 0.5, h[1]));
    });
    // tiny distant houses on the hills (no colliders — outside the bounds)
    [[26, -24, 0.5], [-27, -18, -0.3], [27, 22, 1.2]].forEach(function (h) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(1.6, 1.0, 1.3), plasterMat(0xf5e6c8), 0, 0.5, 0));
      g.add(mesh(new THREE.ConeGeometry(1.4, 0.9, 4), roofMat(0xb85c4a), 0, 1.45, 0, 0, Math.PI / 4, 0));
      g.position.set(h[0], 0, h[1]); g.rotation.y = h[2];
      scene.add(g);
    });
  }

  // ================= LAYOUT =================
  // ---- market square (west bank, by the bridge): fashion + gifts flank
  // the plaza, facing it; 2 stalls on the plaza ----
  shop(-6.5, -4.8, 0.15, 1.1, { wall: 0xf7ead2, wood: 0x8b5e3c, roof: 0x5a6a7a, noren: 0xd96c8a, awning: 0xe86a8a, emblem: 'blossom', shopId: 'fashion' });
  shop(-6.5, 5.8, 2.99, 1.1, { wall: 0xf7ead2, wood: 0x9a6a42, roof: 0x5a7a6a, noren: 0x14b8a6, awning: 0x5ec4b8, emblem: 'gift', shopId: 'gifts' });
  // ---- east bank: colors + farm facing the river/bridge ----
  shop(7, -4.5, -1.35, 1.1, { wall: 0xf7ead2, wood: 0x8b5e3c, roof: 0x6a5a7a, noren: 0x8b5cf6, awning: 0xb48ce8, emblem: 'drop', shopId: 'colors' });
  shop(7, 4.5, -1.35, 1.1, { wall: 0xf7ead2, wood: 0xa5713f, roof: 0x8a5a4a, noren: 0xf97316, awning: 0xf08a4b, emblem: 'leaf', shopId: 'farm' });
  stall(-5.2, -2.2, 0.3, 0xe86a8a);
  stall(-7.2, 2.5, -0.4, 0x5ec4b8);
  // ---- residential quarters (west 5 + east 3) ----
  machiya(-12, -6, 1.4, 1, { wall: 0xf5e6c8, wood: 0x9a6a42, roof: 0xb85c4a, noren: 0x2e4a7a, balcony: true });
  minka(-13.5, 2, 1.7, 0.9, { wood: 0xa5713f, roof: 0x6a5a4a, noren: 0x5e9a6a });
  machiya(-11, 9, 1.2, 0.9, { wall: 0xefe0c2, wood: 0x7a5230, roof: 0x8a4a3a, noren: 0x8a4a6a, balcony: false });
  house(-6.8, -12, 0.8, 1, { wall: 0xf5e6c8, wood: 0x8b5e3c, roof: 0x7a6a5a, noren: 0x5e9a6a });
  house(-5.5, 13.5, 3.0, 1, { wall: 0xf7ead2, wood: 0x9a6a42, roof: 0xb85c4a, noren: 0xd96c8a }); // farmhouse by the fields
  minka(12, -8, -1.4, 0.9, { wood: 0x8b5e3c, roof: 0x5a6a7a, noren: 0x2e4a7a });
  machiya(13, 6, -1.2, 0.9, { wall: 0xf5e6c8, wood: 0x7a5230, roof: 0x8a4a3a, noren: 0x8a4a6a, balcony: false });
  house(10, 10.5, -0.5, 1, { wall: 0xf7ead2, wood: 0x9a6a42, roof: 0x6a5a4a, noren: 0x5e9a6a });
  // ---- landmarks + props ----
  torii(-3.6, 0, Math.PI / 2); // west bridge approach (player walks through, between the posts)
  torii(3.6, 0, Math.PI / 2); // east bridge approach
  wisteria(-3.4, 10.5, 0.2); // over the west bank path, south of the plaza
  well(-8.2, 0.5); // on the market square
  stoneLantern(-2.9, -3.4); stoneLantern(-2.9, 3.4); // flanking the bridge, west
  stoneLantern(2.9, -3.4); stoneLantern(2.9, 3.4); // flanking the bridge, east
  stoneLantern(-8.5, -3.5); stoneLantern(8.8, 2.5);
  bench(-2.9, -5.5, Math.PI / 2); // west bank, facing the river
  bench(2.9, 6.5, -Math.PI / 2); // east bank, facing the river
  bench(-4.5, 3.2, 0.4); // market square
  flowerBed(-4, -4.8, 0); flowerBed(-4, 6.5, 0);
  flowerBed(5.5, -6.5, 0); flowerBed(6, 8.5, 0);
  fenceRun(-20, -18.6, 20, -18.6); // north edge (outside minZ = -18)
  fenceRun(-20, 20.6, 20, 20.6); // south edge (outside maxZ = 20)
  fenceRun(-20.6, -18, -20.6, 20); // west edge (outside minX = -20)
  fenceRun(20.6, -18, 20.6, 20); // east edge (outside maxX = 20)
  lantern(-3.4, -7); lantern(-3.4, 12); lantern(3.4, -7); lantern(3.4, 12);
  riverAndBridge();
  riceFields();
  hills();
  // sakura trees (grove ring NW, plaza/river edges, districts)
  tree(-14.5, -8.5, 1); tree(-9.5, -8.5, 1.05); tree(-14.5, -12, 0.95); tree(-9.5, -12, 1); tree(-12, -7.5, 1.05);
  tree(-8.5, 7.5, 1); tree(-8.8, -7.5, 1); tree(8.8, -7.5, 1); tree(8.5, 7.5, 1.05);
  tree(-15.5, 6, 0.9); tree(15.5, -4, 1); tree(16, 11, 1); tree(-16, -11, 1);
  tree(5.5, -9.5, 1); tree(5.5, 13, 1);
  // green trees (edges, fields border, river ends)
  greenTree(-17, -2, 1.1); greenTree(-17, 10, 1); greenTree(-3, -16, 1.05); greenTree(4, -16, 1);
  greenTree(17, -12, 1); greenTree(17, 2, 1.05); greenTree(17, 10.5, 1);
  greenTree(-6, 17.5, 1); greenTree(5, 17, 1); greenTree(2.5, -16.5, 1);
  // grove pond (flat disc + lily pads; blocked by a collider so nobody
  // wades through it)
  scene.add(flat(new THREE.CircleGeometry(1.6, 24), mat(0x7ec8e3, { transparent: true, opacity: 0.85 }), -12, 0.012, -10));
  scene.add(flat(new THREE.CircleGeometry(0.22, 12), mat(0x5e9a6a), -12.4, 0.03, -10.3));
  scene.add(flat(new THREE.CircleGeometry(0.18, 12), mat(0x5e9a6a), -11.5, 0.03, -9.6));
  addCollider(-12, -10, 1.6);
  // NPCs: the other 3 default characters — sara by the plaza/bridge (west),
  // yusuf on the east bank by the farm shop, layan on the east bank by the
  // colors shop. Each stands > 1.0 clear of every collider edge (see
  // NOTES.md for the distances). NO name labels (v1.4.2).
  // v1.7: ARTICULATED builds (same look as buildCharacter) — the living-NPC
  // controller in main.js drives them with the Player walk class, so they
  // wander the map. Their blob shadow disc is returned in the handle so
  // main.js can move it with the NPC (a static disc would stay at spawn).
  const npcs = [
    { x: -4.6, z: 0.2, ry: -1.3, key: 'sara' },
    { x: 4.6, z: 7.5, ry: 0.55, key: 'yusuf' },
    { x: 3.6, z: -5, ry: 2.2, key: 'layan' },
  ];
  const handles = [];
  for (const p of npcs) {
    const a = buildArticulatedCharacter(p.key, getAppearance(p.key));
    fitHeight(a, 1.37, 0);
    a.position.x = p.x; a.position.z = p.z; a.rotation.y = p.ry;
    a.userData.npcKey = p.key;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.9, 10), hitMat);
    hit.position.y = 0.95;
    a.add(hit);
    scene.add(a);
    const disc = shadowDisc(p.x, p.z, 0.42);
    scene.add(disc);
    handles.push({ key: p.key, group: a, disc: disc });
  }
  applyShadowFlags(scene);
  return {
    npcs: handles,
    shops: shops,
    colliders: colliders,
    stats: {
      mapId: 'b', name: 'قرية النهر',
      buildings: 12, designs: ['shop', 'machiya', 'minka', 'house'],
      shops: 4, shopIds: shops.map((s) => s.id),
      stalls: 2, torii: 2, stoneLanterns: 6, benches: 3, well: 1, fences: 4,
      flowerBeds: 4, trees: 14, greenTrees: 10, poleLanterns: 4,
      river: true, bridge: true, riceFields: 4, sakuraGrove: true, hills: 6,
      wisteria: 1, pond: 1, colliders: colliders.length,
    },
  };
}

export const MAP = {
  id: 'b',
  name: 'قرية النهر',
  bounds: { minX: -20, maxX: 20, minZ: -18, maxZ: 20 },
  // facing the bridge (bridge centre (0,0) is on the facing axis):
  // atan2(-(0-(-3)), -(0-4.8)) = atan2(-3, 4.8) = -0.558
  start: { x: -3, z: 4.8, ry: -0.558 },
  buildEnv: buildEnv,
  // v1.7: river x-band + bridge deck centre (0,0) — the living NPCs route
  // through the deck when crossing banks (deck gap z -1.15..1.15 at x=0,
  // i.e. bridge.z ± 1.15 = `gap`, the open collider corridor).
  river: { min: -1.5, max: 1.5, bridge: { x: 0, z: 0 }, gap: 1.15 },
};
