// Suli Anime v1 — playable VRM character: procedural walk + follow camera.
// The VRM model ships with NO animation clips, so walking is procedural:
// legs/arms swing by rotating their bones, hips bob, and everything eases
// back to the standing pose when the player stops.
import * as THREE from 'three';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
// shortest-arc angle lerp (handles the +-PI wrap)
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

class Player {
  // model: posed + fitted VRM group. bounds: {minX,maxX,minZ,maxZ}.
  // start: {x, z, ry} — ry is the model's rotation.y (model faces -Z at ry=0).
  constructor(model, bounds, start) {
    this.model = model;
    this.bounds = bounds;
    this.baseY = model.position.y;
    this.speed = 2.4;                 // world units per second
    this.phase = 0;                   // walk-cycle phase
    this.moving = false;
    this.walkAmount = 0;              // 0 = standing, 1 = full walk (eased)
    this.target = null;               // tap-to-move destination {x, z}
    this.facing = start.ry || 0;      // smoothed facing angle
    this.model.position.x = start.x || 0;
    this.model.position.z = start.z || 0;
    this.model.rotation.y = this.facing;
    // bones (VRM 0.x standard names)
    const b = (n) => model.getObjectByName(n);
    this.bones = {
      hips: b('J_Bip_C_Hips'),
      legL: b('J_Bip_L_UpperLeg'), legR: b('J_Bip_R_UpperLeg'),
      kneeL: b('J_Bip_L_LowerLeg'), kneeR: b('J_Bip_R_LowerLeg'),
      armL: b('J_Bip_L_UpperArm'), armR: b('J_Bip_R_UpperArm'),
      foreL: b('J_Bip_L_LowerArm'), foreR: b('J_Bip_R_LowerArm'),
    };
    // rest pose: arms keep their posed z (from poseVRM), x = 0 everywhere
    this.rest = {};
    for (const k in this.bones) {
      const bone = this.bones[k];
      if (bone) this.rest[k] = bone.rotation.clone();
    }
  }

  setTarget(x, z) {
    this.target = {
      x: clamp(x, this.bounds.minX, this.bounds.maxX),
      z: clamp(z, this.bounds.minZ, this.bounds.maxZ),
    };
  }
  cancelTarget() { this.target = null; }

  // dir: {x, z} world-space move direction (already camera-relative),
  // magnitude 0..1. dt in seconds. Returns true while moving.
  update(dt, dir) {
    let mx = 0, mz = 0, mag = 0;
    if (dir && (dir.x !== 0 || dir.z !== 0)) {
      mx = dir.x; mz = dir.z;
      mag = Math.min(1, Math.hypot(mx, mz));
      const l = Math.hypot(mx, mz) || 1;
      mx /= l; mz /= l;
      this.target = null; // direct input overrides tap-to-move
    } else if (this.target) {
      const dx = this.target.x - this.model.position.x;
      const dz = this.target.z - this.model.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.18) { this.target = null; }
      else { mx = dx / d; mz = dz / d; mag = d < 0.8 ? 0.45 : 1; }
    }
    this.moving = mag > 0.02;
    if (this.moving) {
      const step = this.speed * mag * dt;
      this.model.position.x = clamp(this.model.position.x + mx * step, this.bounds.minX, this.bounds.maxX);
      this.model.position.z = clamp(this.model.position.z + mz * step, this.bounds.minZ, this.bounds.maxZ);
      // model faces -Z at ry=0, so facing for direction (mx,mz) is atan2(-mx,-mz)
      const want = Math.atan2(-mx, -mz);
      this.facing = lerpAngle(this.facing, want, Math.min(1, dt * 10));
      this.model.rotation.y = this.facing;
      this.phase += dt * 9 * Math.max(0.4, mag); // ~1.4 steps/sec at full speed
    }
    // ease the walk pose in/out
    const goal = this.moving ? 1 : 0;
    this.walkAmount += (goal - this.walkAmount) * Math.min(1, dt * 8);
    if (!this.moving && this.walkAmount < 0.02) this.walkAmount = 0;
    this._pose();
    return this.moving;
  }

  _pose() {
    const w = this.walkAmount;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const B = this.bones, R = this.rest;
    const setX = (bone, rest, x) => { if (bone) bone.rotation.x = rest.x + x * w; };
    if (B.legL && R.legL) setX(B.legL, R.legL, s * 0.55);
    if (B.legR && R.legR) setX(B.legR, R.legR, -s * 0.55);
    // knees bend when the leg swings back / lifts
    if (B.kneeL && R.kneeL) setX(B.kneeL, R.kneeL, Math.max(0, -s) * 0.7 + 0.06 * w);
    if (B.kneeR && R.kneeR) setX(B.kneeR, R.kneeR, Math.max(0, s) * 0.7 + 0.06 * w);
    // arms swing opposite to the same-side leg; z stays at the posed value
    if (B.armL && R.armL) setX(B.armL, R.armL, -s * 0.4);
    if (B.armR && R.armR) setX(B.armR, R.armR, s * 0.4);
    if (B.foreL && R.foreL) setX(B.foreL, R.foreL, -0.25 * w);
    if (B.foreR && R.foreR) setX(B.foreR, R.foreR, -0.25 * w);
    // hips: gentle bob (twice per cycle) + slight sway
    if (B.hips && R.hips) {
      B.hips.rotation.z = R.hips.z + Math.sin(this.phase) * 0.05 * w;
      B.hips.rotation.x = R.hips.x + Math.sin(this.phase * 2) * 0.03 * w;
    }
    this.model.position.y = this.baseY + Math.abs(c) * 0.045 * w;
  }

  get position() { return this.model.position; }
}

// ---- Follow camera: stays behind the player, swings around as they turn ----
class FollowCamera {
  // cam: THREE.PerspectiveCamera. dist/height: offset behind+above the player.
  constructor(cam, dist, height) {
    this.cam = cam;
    this.dist = dist || 4.6;
    this.height = height || 2.7;
    this.yaw = 0; // offset direction = (sin yaw, 0, cos yaw) from the player
    this._look = new THREE.Vector3();
    this._pos = new THREE.Vector3();
  }
  snapTo(player) { this.yaw = player.facing; this._apply(player, 1); }
  update(dt, player) {
    // camera swings behind the player's facing direction (smoothly)
    this.yaw = lerpAngle(this.yaw, player.facing, Math.min(1, dt * 2.2));
    this._apply(player, Math.min(1, dt * 6));
  }
  _apply(player, t) {
    const p = player.position;
    const tx = p.x + Math.sin(this.yaw) * this.dist;
    const ty = p.y + this.height;
    const tz = p.z + Math.cos(this.yaw) * this.dist;
    this.cam.position.x += (tx - this.cam.position.x) * t;
    this.cam.position.y += (ty - this.cam.position.y) * t;
    this.cam.position.z += (tz - this.cam.position.z) * t;
    this._look.set(p.x, p.y + 1.25, p.z);
    this.cam.lookAt(this._look);
  }
  // camera-relative ground axes: forward (where the camera looks) and right
  axes() {
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return { fwd: f, right: r };
  }
}

// ---- Input: keyboard (WASD/arrows) + virtual joystick + tap-to-move ----
// joystickEl: the round base element; knobEl: the moving knob inside it.
// canvasEl: the 3D canvas — taps on it (not on the joystick) set a move target.
// onTap(point): called with the ground-plane {x, z} of a canvas tap.
function createInput(joystickEl, knobEl, canvasEl, camera, onTap) {
  const keys = {};
  const joy = { x: 0, y: 0, active: false, id: null };
  const RAY = new THREE.Raycaster();
  const PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function keyDir() {
    let x = 0, z = 0;
    if (keys['KeyW'] || keys['ArrowUp']) z -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) z += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) x -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) x += 1;
    return { x, z };
  }
  window.addEventListener('keydown', (e) => {
    if (e.code in keys || ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
      keys[e.code] = true;
      if (e.code.startsWith('Arrow')) e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // virtual joystick (touch + mouse, for desktop testing)
  const base = joystickEl;
  const R = 44; // knob travel radius in px
  function joyMove(clientX, clientY) {
    const r = base.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2);
    let dy = clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    joy.x = dx / R; joy.y = dy / R;
  }
  function joyEnd() {
    joy.active = false; joy.id = null; joy.x = 0; joy.y = 0;
    knobEl.style.transform = 'translate(0px,0px)';
  }
  base.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    joy.active = true; joy.id = t.identifier;
    joyMove(t.clientX, t.clientY);
  }, { passive: false });
  base.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joy.id) joyMove(t.clientX, t.clientY);
    }
  }, { passive: false });
  base.addEventListener('touchend', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joy.id) joyEnd();
    }
  });
  base.addEventListener('touchcancel', joyEnd);
  base.addEventListener('mousedown', (e) => { joy.active = true; joy.id = 'mouse'; joyMove(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (joy.active && joy.id === 'mouse') joyMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { if (joy.active && joy.id === 'mouse') joyEnd(); });

  // tap-to-move on the canvas: raycast the tap onto the ground plane
  let downAt = 0, downX = 0, downY = 0;
  canvasEl.addEventListener('pointerdown', (e) => { downAt = Date.now(); downX = e.clientX; downY = e.clientY; });
  canvasEl.addEventListener('pointerup', (e) => {
    if (Date.now() - downAt > 350) return; // it was a drag, not a tap
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return;
    const r = canvasEl.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    RAY.setFromCamera({ x: nx, y: ny }, camera);
    const hit = new THREE.Vector3();
    if (RAY.ray.intersectPlane(PLANE, hit)) onTap({ x: hit.x, z: hit.z });
  });

  // combined move vector in SCREEN space: {x: right+, y: down+}, magnitude 0..1
  function screenVec() {
    const k = keyDir();
    if (k.x !== 0 || k.z !== 0) return { x: k.x, y: k.z };
    if (joy.active) return { x: joy.x, y: joy.y };
    return { x: 0, y: 0 };
  }
  // world-space direction from the screen vector, relative to the camera axes
  function worldDir(camFollow) {
    const s = screenVec();
    if (s.x === 0 && s.y === 0) return null;
    const a = camFollow.axes();
    // screen up (y=-1) = camera forward; screen right = camera right
    const wx = a.fwd.x * -s.y + a.right.x * s.x;
    const wz = a.fwd.z * -s.y + a.right.z * s.x;
    const l = Math.hypot(wx, wz) || 1;
    const mag = Math.min(1, Math.hypot(s.x, s.y));
    return { x: wx / l * mag, z: wz / l * mag };
  }
  return { screenVec, worldDir, joy, keys };
}

// ---- Fixed diorama camera (small interiors): the room has only two walls,
// so a follow camera would swing out through the open sides and show sky.
// Instead the camera sits on the open side and pans its gaze toward the
// player, always looking INTO the room. Same interface as FollowCamera.
class FixedCamera {
  // pos: fixed camera position; lookBase: lookAt point when player is at origin.
  constructor(cam, pos, lookBase) {
    this.cam = cam;
    this.pos = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.lookBase = new THREE.Vector3(lookBase.x, lookBase.y, lookBase.z);
    this._look = this.lookBase.clone();
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this._look);
  }
  snapTo(player) { this._setLook(player, 1); }
  update(dt, player) { this._setLook(player, Math.min(1, dt * 4)); }
  _setLook(player, t) {
    const p = player.position;
    const tx = this.lookBase.x + p.x * 0.6;
    const ty = this.lookBase.y;
    const tz = this.lookBase.z + p.z * 0.6;
    this._look.x += (tx - this._look.x) * t;
    this._look.y += (ty - this._look.y) * t;
    this._look.z += (tz - this._look.z) * t;
    this.cam.lookAt(this._look);
  }
  // screen up = -Z (toward the back wall), screen right = +X
  axes() {
    return { fwd: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0) };
  }
}

export { Player, FollowCamera, FixedCamera, createInput };
