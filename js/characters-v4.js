// Suli Anime D1 v4 — Detailed anime characters built from primitives (ES module).
// The user rejected v3 (pasted reference photos) and v2 (bland VRoid samples).
// No detailed free anime 3D models with verifiable licences exist for 2 boys +
// 2 girls (see MANIFEST.md search log), so the 4 default characters are built
// here as full 3D figures matching the user's reference illustrations:
//   kaito — boy, red spiky hair w/ blue streaks, blue eyes, black suit + teal tie
//   yusuf — boy, red spiky hair w/ green/yellow streaks, blue eyes, black shirt
//   sara  — girl, brown shoulder hair, purple eyes, white cat tee + plaid skirt
//   layan — girl, dark shoulder hair, brown eyes, oversized black hoodie
// Characters face +Z, feet at y=0, nominal height ~1.6 (fit via bounding box).
// v1.3: buildCharacter(key, app) accepts appearance overrides
// { haircolor, skin, eyecolor, outfitcolor } (hex strings) — the live colors
// from the creator. Without them the spec colors are used, unchanged.
import * as THREE from 'three';

const SKIN = 0xffd9b3;
const SKIN_SHADE = 0xe8b48c;

function mat(color, opts) {
  return new THREE.MeshLambertMaterial(Object.assign({ color: color }, opts || {}));
}
function mesh(geo, material, x, y, z, rx, ry, rz) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x || 0, y || 0, z || 0);
  if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
  return m;
}
// cone pointing along direction (dx,dy,dz) from its base centre
function spike(r, h, material, x, y, z, dx, dy, dz, flat) {
  const g = new THREE.ConeGeometry(r, h, 6);
  const m = new THREE.Mesh(g, material);
  if (flat) m.scale.z = flat;
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  // cone origin is its centre; shift so the BASE sits at (x,y,z)
  m.position.set(x + dir.x * h / 2, y + dir.y * h / 2, z + dir.z * h / 2);
  return m;
}

// ---- plaid texture (Sara's skirt) ----
function plaidTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#7ba3d4'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = 'rgba(74,111,165,0.55)';
  for (let i = 0; i < 4; i++) { x.fillRect(i * 64 + 10, 0, 20, 256); x.fillRect(0, i * 64 + 10, 256, 20); }
  x.fillStyle = 'rgba(139,123,184,0.85)';
  for (let i = 0; i < 4; i++) { x.fillRect(i * 64 + 40, 0, 5, 256); x.fillRect(0, i * 64 + 40, 256, 5); }
  x.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 4; i++) { x.fillRect(i * 64 + 52, 0, 3, 256); x.fillRect(0, i * 64 + 52, 256, 3); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
  return t;
}

// ================= FACE =================
function buildFace(g, spec, headY) {
  const skinM = mat(spec.skin);
  // head
  const head = mesh(new THREE.SphereGeometry(0.115, 24, 18), skinM, 0, headY, 0);
  head.scale.set(0.92, 1.08, 0.95);
  g.add(head);
  // ears
  [-1, 1].forEach(function (s) {
    const e = mesh(new THREE.SphereGeometry(0.02, 10, 8), skinM, s * 0.104, headY, 0);
    e.scale.set(0.5, 1, 0.8); g.add(e);
  });
  const eyeM = mat(0xffffff);
  const irisM = mat(spec.eye);
  const pupilM = mat(0x14100f);
  const lashM = mat(0x2b1d1d);
  [-1, 1].forEach(function (s) {
    const ex = s * 0.043, ey = headY + 0.015;
    // sclera: big anime eye, tall ellipse
    const sc = mesh(new THREE.SphereGeometry(0.026, 16, 12), eyeM, ex, ey, 0.094);
    sc.scale.set(0.9, 1.3, 0.35); g.add(sc);
    // iris
    const ir = mesh(new THREE.CircleGeometry(0.019, 20), irisM, ex, ey - 0.001, 0.1035);
    ir.scale.set(1, 1.25, 1); g.add(ir);
    // pupil
    g.add(mesh(new THREE.CircleGeometry(0.009, 14), pupilM, ex, ey - 0.001, 0.105));
    // highlight
    g.add(mesh(new THREE.CircleGeometry(0.006, 10), eyeM, ex - s * 0.006, ey + 0.007, 0.1065));
    // upper lash: dark arc over the eye
    const lash = mesh(new THREE.TorusGeometry(0.028, 0.005, 6, 16, Math.PI * 0.75), lashM, ex, ey, 0.102);
    lash.rotation.z = Math.PI * 0.125; g.add(lash);
    // eyebrow
    const br = mesh(new THREE.BoxGeometry(0.036, 0.007, 0.006), mat(spec.hair), s * 0.043, headY + 0.055, 0.10);
    br.rotation.z = s * -0.12; g.add(br);
    // blush
    const bl = mesh(new THREE.CircleGeometry(0.013, 12), mat(0xf4a7b9, { transparent: true, opacity: 0.55 }), s * 0.068, headY - 0.015, 0.084);
    bl.rotation.y = s * 0.5; g.add(bl);
  });
  // nose (tiny)
  g.add(mesh(new THREE.SphereGeometry(0.006, 8, 6), mat(SKIN_SHADE), 0, headY - 0.015, 0.108));
  // mouth: small smile (bottom arc)
  const mo = mesh(new THREE.TorusGeometry(0.013, 0.003, 6, 12, Math.PI * 0.85), mat(0xc96a6a), 0, headY - 0.045, 0.104);
  mo.rotation.z = Math.PI * 1.075; g.add(mo);
}

// ================= HAIR =================
function buildHair(g, spec, headY) {
  const hairM = mat(spec.hair);
  // cap: top of head, edge sits just behind the eye plane so eyes stay visible
  const cap = mesh(new THREE.SphereGeometry(0.128, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), hairM, 0, headY + 0.025, -0.015);
  cap.scale.set(0.96, 1.05, 0.98);
  g.add(cap);
  // bangs: 5 flattened cones across the forehead, tips at brow level
  const bangH = spec.gender === 'f' ? 0.13 : 0.12;
  [-0.07, -0.035, 0, 0.035, 0.07].forEach(function (bx, i) {
    const b = mesh(new THREE.ConeGeometry(0.036, bangH, 6), hairM, bx, headY + 0.065, 0.082, Math.PI - 0.35, 0, 0);
    b.scale.z = 0.4;
    b.rotation.z = (i - 2) * 0.09; // fan outward slightly
    g.add(b);
  });
  if (spec.hairStyle === 'spiky') {
    // messy spiky top: short thick cones sweeping up/forward from the dome
    const spikes = [
      [0, 1.55, 0.01, 0.1, 1, 0.25, 0.11, 0.048], [0.05, 1.545, 0.02, 0.5, 1, 0.3, 0.10, 0.044],
      [-0.05, 1.545, 0.02, -0.5, 1, 0.3, 0.10, 0.044], [0, 1.545, -0.05, 0, 1, -0.55, 0.10, 0.044],
      [0.08, 1.515, -0.02, 0.85, 0.7, -0.15, 0.09, 0.040], [-0.08, 1.515, -0.02, -0.85, 0.7, -0.15, 0.09, 0.040],
      [0.03, 1.54, 0.06, 0.3, 1, 0.6, 0.09, 0.038], [-0.03, 1.54, 0.06, -0.3, 1, 0.6, 0.09, 0.038],
    ];
    spikes.forEach(function (s) { g.add(spike(s[7], s[6], hairM, s[0], s[1], s[2], s[3], s[4], s[5], 0.55)); });
    // short back hair
    const back = mesh(new THREE.SphereGeometry(0.11, 16, 12), hairM, 0, headY + 0.01, -0.045);
    back.scale.set(0.9, 1.0, 0.7); g.add(back);
    // coloured streaks: thin strands over the hair
    const streakM = mat(spec.streak);
    const streaks = [
      [0.075, 1.47, 0.07, 0.35, -0.9, 0.25], [-0.075, 1.47, 0.07, -0.35, -0.9, 0.25],
      [0.10, 1.44, 0.02, 0.55, -0.8, 0.1], [-0.10, 1.44, 0.02, -0.55, -0.8, 0.1],
    ];
    streaks.forEach(function (s) { g.add(spike(0.011, 0.15, streakM, s[0], s[1], s[2], s[3], s[4], s[5], 0.35)); });
    if (spec.streak2) {
      const m2 = mat(spec.streak2);
      g.add(spike(0.010, 0.13, m2, 0.04, 1.50, 0.075, 0.2, -0.9, 0.35, 0.35));
      g.add(spike(0.010, 0.13, m2, -0.05, 1.49, 0.07, -0.25, -0.9, 0.3, 0.35));
    }
  } else {
    // shoulder-length: back mass + side locks
    const back = mesh(new THREE.SphereGeometry(0.12, 18, 14), hairM, 0, headY - 0.09, -0.06);
    back.scale.set(1.0, 1.5, 0.8); g.add(back);
    [-1, 1].forEach(function (s) {
      const lock = mesh(new THREE.CapsuleGeometry(0.023, 0.26, 4, 10), hairM, s * 0.10, headY - 0.11, 0.01);
      lock.rotation.z = s * 0.06; g.add(lock);
    });
    if (spec.clip) {
      g.add(mesh(new THREE.BoxGeometry(0.022, 0.009, 0.012), mat(spec.clip), 0.07, headY + 0.08, 0.06, 0, 0, 0.3));
    }
  }
}

// ================= BODY =================
function buildBody(g, spec) {
  const skinM = mat(spec.skin);
  const torsoR = spec.gender === 'f' ? 0.098 : 0.105;
  const outfitM = mat(spec.outfitColor);
  // neck
  g.add(mesh(new THREE.CylinderGeometry(0.034, 0.036, 0.09, 12), skinM, 0, 1.24, 0));
  // torso (hoodie is oversized + longer)
  const tH = spec.outfit === 'hoodie' ? 0.44 : 0.38;
  const tY = spec.outfit === 'hoodie' ? 0.99 : 1.00;
  const tR = spec.outfit === 'hoodie' ? 0.115 : torsoR;
  g.add(mesh(new THREE.CylinderGeometry(tR, spec.outfit === 'hoodie' ? 0.115 : torsoR - 0.017, tH, 18), outfitM, 0, tY, 0));
  // shoulders
  const sh = mesh(new THREE.SphereGeometry(0.10, 16, 12), outfitM, 0, 1.17, 0);
  sh.scale.set(spec.outfit === 'hoodie' ? 1.45 : 1.35, 0.62, 0.95); g.add(sh);
  // hips
  const hipM = spec.outfit === 'skirt' ? mat(0x5b7fa6) : outfitM;
  const hip = mesh(new THREE.SphereGeometry(0.09, 16, 12), hipM, 0, 0.80, 0);
  hip.scale.set(1.25, 0.75, 0.9); g.add(hip);
  // arms
  const sleeveLong = spec.outfit === 'suit' || spec.outfit === 'hoodie';
  const armR = spec.outfit === 'hoodie' ? 0.036 : 0.031;
  [-1, 1].forEach(function (s) {
    const upper = mesh(new THREE.CylinderGeometry(armR, armR - 0.003, 0.24, 10), outfitM, s * 0.148, 1.04, 0);
    upper.rotation.z = s * 0.10; g.add(upper);
    const foreM = sleeveLong ? outfitM : skinM;
    const fore = mesh(new THREE.CylinderGeometry(0.027, 0.024, 0.22, 10), foreM, s * 0.162, 0.82, 0.03);
    fore.rotation.z = s * 0.06; fore.rotation.x = -0.18; g.add(fore);
    g.add(mesh(new THREE.SphereGeometry(0.034, 12, 10), skinM, s * 0.164, 0.70, 0.05));
  });
  // legs
  const pantsM = mat(spec.pants);
  [-1, 1].forEach(function (s) {
    const lx = s * 0.055;
    if (spec.outfit === 'skirt') {
      g.add(mesh(new THREE.CylinderGeometry(0.046, 0.040, 0.34, 12), skinM, lx, 0.59, 0)); // thigh (skin)
      g.add(mesh(new THREE.CylinderGeometry(0.038, 0.033, 0.36, 12), skinM, lx, 0.24, 0)); // shin (skin)
      g.add(mesh(new THREE.CylinderGeometry(0.040, 0.036, 0.07, 12), mat(0xf5f5f5), lx, 0.10, 0)); // ankle sock
    } else if (spec.outfit === 'hoodie') {
      g.add(mesh(new THREE.CylinderGeometry(0.046, 0.040, 0.34, 12), skinM, lx, 0.59, 0)); // thigh (skin above socks)
      g.add(mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.30, 12), mat(0x374151), lx, 0.27, 0)); // thigh-high sock
      const band = mesh(new THREE.TorusGeometry(0.042, 0.008, 8, 18), mat(0xf4a7b9), lx, 0.42, 0);
      band.rotation.x = Math.PI / 2; g.add(band);
    } else {
      g.add(mesh(new THREE.CylinderGeometry(0.046, 0.040, 0.34, 12), pantsM, lx, 0.59, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.038, 0.033, 0.36, 12), pantsM, lx, 0.24, 0));
    }
    // shoe
    const shoe = mesh(new THREE.BoxGeometry(0.075, 0.055, 0.17), mat(spec.shoes), lx, 0.028, 0.025);
    g.add(shoe);
  });
  // ---- outfit details ----
  if (spec.outfit === 'suit') {
    // white shirt V
    const tri = new THREE.Shape();
    tri.moveTo(-0.045, 0.06); tri.lineTo(0.045, 0.06); tri.lineTo(0, -0.09); tri.closePath();
    g.add(mesh(new THREE.ShapeGeometry(tri), mat(0xf8f8f8), 0, 1.13, 0.104));
    // collar
    [-1, 1].forEach(function (s) {
      const c = mesh(new THREE.BoxGeometry(0.032, 0.02, 0.006), mat(0xf8f8f8), s * 0.036, 1.175, 0.105);
      c.rotation.z = s * -0.5; g.add(c);
    });
    // tie + knot (teal)
    g.add(mesh(new THREE.BoxGeometry(0.026, 0.15, 0.008), mat(spec.tie), 0, 1.05, 0.107));
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.032, 0.012), mat(spec.tie), 0, 1.145, 0.106));
  }
  if (spec.outfit === 'tee') {
    // teal side stripes + green diagonal accent
    [-1, 1].forEach(function (s) {
      const st = mesh(new THREE.BoxGeometry(0.012, 0.30, 0.01), mat(0x2dd4bf), s * 0.093, 1.00, 0.03);
      st.rotation.y = s * -0.6; g.add(st);
    });
    const dg = mesh(new THREE.BoxGeometry(0.10, 0.015, 0.006), mat(0x7dd956), 0.02, 1.10, 0.102);
    dg.rotation.z = 0.5; g.add(dg);
  }
  if (spec.outfit === 'skirt') {
    // plaid pleated skirt (v1.3: outfit color tints the plaid; the default
    // #f5f5f5 leaves it unchanged)
    const skirtM = new THREE.MeshLambertMaterial({ map: plaidTexture(), color: spec.outfitColor });
    g.add(mesh(new THREE.CylinderGeometry(0.092, 0.155, 0.24, 24, 1, true), skirtM, 0, 0.70, 0));
    const wb = mesh(new THREE.TorusGeometry(0.092, 0.012, 8, 24), mat(0x5b7fa6), 0, 0.815, 0);
    wb.rotation.x = Math.PI / 2; g.add(wb);
    // tiny black cat on the tee
    const catM = mat(0x1a1a1a);
    g.add(mesh(new THREE.CircleGeometry(0.011, 12), catM, 0.03, 1.10, 0.103));
    g.add(mesh(new THREE.ConeGeometry(0.004, 0.008, 4), catM, 0.022, 1.113, 0.103));
    g.add(mesh(new THREE.ConeGeometry(0.004, 0.008, 4), catM, 0.038, 1.113, 0.103));
    // purple backpack
    const bpM = mat(0x8b7bb8);
    g.add(mesh(new THREE.BoxGeometry(0.17, 0.21, 0.07), bpM, 0, 1.02, -0.115));
    g.add(mesh(new THREE.BoxGeometry(0.11, 0.09, 0.03), mat(0x7a68a8), 0, 0.99, -0.155));
    [-1, 1].forEach(function (s) {
      const strap = mesh(new THREE.BoxGeometry(0.03, 0.16, 0.012), mat(0x6e5a9e), s * 0.06, 1.10, -0.095);
      strap.rotation.x = 0.15; g.add(strap);
    });
  }
  if (spec.outfit === 'hoodie') {
    // hood behind the neck
    const hood = mesh(new THREE.SphereGeometry(0.095, 16, 12), outfitM, 0, 1.26, -0.055);
    hood.scale.set(1.15, 0.85, 0.8); g.add(hood);
    // drawstrings
    [-1, 1].forEach(function (s) {
      g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.09, 6), mat(0xd8d8d8), s * 0.025, 1.13, 0.115));
      g.add(mesh(new THREE.SphereGeometry(0.006, 8, 6), mat(0xd8d8d8), s * 0.025, 1.085, 0.115));
    });
    // kangaroo pocket
    g.add(mesh(new THREE.BoxGeometry(0.13, 0.10, 0.015), mat(0x23262f), 0, 0.86, 0.108));
  }
}

// ================= SPECS =================
const SPECS = {
  kaito: { gender: 'm', hair: 0xc0392b, streak: 0x2aa5c4, eye: 0x2f7fc4,
    hairStyle: 'spiky', outfit: 'suit', outfitColor: 0x2e2e3d,
    pants: 0x2e2e3d, shoes: 0x1a1a22, tie: 0x35a0a0 },
  yusuf: { gender: 'm', hair: 0xc0392b, streak: 0x7dd956, streak2: 0xd8e64a, eye: 0x2f9fd8,
    hairStyle: 'spiky', outfit: 'tee', outfitColor: 0x1e1e26,
    pants: 0x2b3245, shoes: 0x1a1a22 },
  sara: { gender: 'f', hair: 0x6b4226, eye: 0x8b5cf6,
    hairStyle: 'shoulder', outfit: 'skirt', outfitColor: 0xf5f5f5,
    pants: 0x2b3245, shoes: 0x2b3245, clip: 0x9b7ed9 },
  layan: { gender: 'f', hair: 0x4a3542, eye: 0x7c4a2d,
    hairStyle: 'shoulder', outfit: 'hoodie', outfitColor: 0x2b2f3a,
    pants: 0x374151, shoes: 0x1f242e },
};

// Build a full character group (faces +Z, feet at y=0). Returns THREE.Group.
// `app` (v1.3, optional): { haircolor, skin, eyecolor, outfitcolor } hex
// strings from the creator — they override the spec colors for this build.
function buildCharacter(key, app) {
  const spec = Object.assign({}, SPECS[key]);
  if (!spec || !SPECS[key]) throw new Error('unknown character ' + key);
  if (app) {
    if (app.haircolor) spec.hair = app.haircolor;
    if (app.eyecolor) spec.eye = app.eyecolor;
    if (app.outfitcolor) spec.outfitColor = app.outfitcolor;
    if (app.skin) spec.skin = app.skin;
  }
  if (spec.skin === undefined) spec.skin = SKIN;
  const g = new THREE.Group();
  const headY = 1.39;
  buildFace(g, spec, headY);
  buildHair(g, spec, headY);
  buildBody(g, spec);
  // v1.3: the colors this build used (for the creator test hook).
  g.userData.appliedAppearance = {
    haircolor: '#' + new THREE.Color(spec.hair).getHexString(),
    skin: '#' + new THREE.Color(spec.skin).getHexString(),
    eyecolor: '#' + new THREE.Color(spec.eye).getHexString(),
    outfitcolor: '#' + new THREE.Color(spec.outfitColor).getHexString(),
  };
  return g;
}

// Scale group so its bounding-box height == target, feet on groundY.
// Returns the applied scale (so callers can aim cameras at true head height).
function fitHeight(group, target, groundY) {
  const probe = new THREE.Scene();
  probe.add(group);
  probe.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group, true);
  const h = box.max.y - box.min.y;
  const s = target / h;
  group.scale.setScalar(s);
  group.position.set(0, groundY - box.min.y * s, 0);
  return s;
}

export { buildCharacter, fitHeight, SPECS };
