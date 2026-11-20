// Suli Anime v1.2 — playable VRM character: procedural walk + follow camera.
// The VRM model ships with NO animation clips, so walking is procedural:
// legs/arms swing by rotating their bones, hips bob, and everything eases
// back to the standing pose when the player stops.
// v1.2: tap routing only — createInput calls onNPCTap first so a tap on an
// NPC opens their profile instead of moving the player. The Player walk
// code is unchanged from v1.1.
//
// v1.1 rebuilds the walk cycle from gait biomechanics (see _pose):
// correct knee timing (flex in swing, straight at heel-strike), ankle/toe
// articulation, hip yaw/roll/bob, spine counter-rotation, forward lean,
// and stride-matched stepping — the phase advances with DISTANCE TRAVELLED,
// so foot speed matches ground speed and the feet don't slide.
import * as THREE from 'three';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
// shortest-arc angle lerp (handles the +-PI wrap)
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---- walk-cycle tuning (measured on the dero VRM at fit height 1.45) ----
// Hip-joint height 0.784, ankle height 0.098 -> leg length 0.686.
// Hip swing +-0.58 rad gives a 0.75-unit step; at 2.4 u/s that is a
// brisk ~3.2 steps/s — right for a 1.45-tall character at this speed.
// Gait events for the LEFT leg (right leg = same, phase + PI):
//   phase 0     = left mid-swing (passing), right mid-stance
//   phase PI/2  = left heel-strike, right toe-off (double support)
//   phase PI    = right mid-swing (passing), left mid-stance
//   phase 3PI/2 = left toe-off, right heel-strike (double support)
const HIP_AMP = 0.58;        // hip swing amplitude (rad), each way
const LEG_LEN_FALLBACK = 0.686; // hip-joint -> ankle, measured on the rig
const KNEE_SWING = 0.95;     // peak knee flexion mid-swing (rad)
const KNEE_SHIFT = 0.15;     // shifts the knee peak into early-mid swing;
                             // small on purpose: the knee must still be
                             // nearly straight at toe-off (~0.10 rad) or
                             // the toe lifts off the ground before push-off
                             // (0.64 left the trailing toe 0.17 in the air,
// 0.30 still left it 0.085 up)
const KNEE_STANCE = 0.14;    // loading-response flex just after heel-strike
const FOOT_TOEOFF = 0.50;    // foot pitch (toes down) at push-off
const FOOT_HEEL = 0.16;      // foot pitch (toes up) at heel-strike
const TOE_FLEX = 0.55;       // toe-base flex at push-off
const HIP_YAW = 0.12, HIP_ROLL = 0.07;
const SPINE_YAW = 0.03, CHEST_YAW = 0.05, UPPER_YAW = 0.04;
const ARM_SWING = 0.50;
const ELBOW_BASE = 0.35, ELBOW_VAR = 0.15;
const STEP_WIDTH = 0.07;     // swing foot drifts slightly outward (rad) —
                             // real step width, and it keeps the legs
                             // distinct from the follow camera behind
// Elbow hinge axis on the posed-down forearm: the forearm's local X is
// nearly the arm's long axis (a twist, not a bend — v1's fixed -0.25 x
// moved the hand by ~1mm), so flexion is mostly local Y:
// left (0.315, -0.949), right (0.315, +0.949) — measured on the rig.
const ELBOW_X = 0.315, ELBOW_Y = 0.949;
const BOB_FACTOR = 0.85;     // fraction of the geometric hip drop to apply
                             // (0.9 sank the heel ~9mm at heel-strike;
// the shin has a slight backward rest offset that adds drop when swung)

// Hip swing waveform: mostly a triangle wave (near-constant foot speed
// during stance -> the planted foot stays planted) with a sine blend to
// round the heel-strike / toe-off corners. Peaks at +-1, same phases
// as sin(), so all gait events stay at their usual phases.
function hipWave(p) {
  const tri = (2 / Math.PI) * Math.asin(Math.sin(p));
  return 0.8 * tri + 0.2 * Math.sin(p);
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
      spine: b('J_Bip_C_Spine'),
      chest: b('J_Bip_C_Chest'),
      upperChest: b('J_Bip_C_UpperChest'),
      head: b('J_Bip_C_Head'),
      legL: b('J_Bip_L_UpperLeg'), legR: b('J_Bip_R_UpperLeg'),
      kneeL: b('J_Bip_L_LowerLeg'), kneeR: b('J_Bip_R_LowerLeg'),
      footL: b('J_Bip_L_Foot'), footR: b('J_Bip_R_Foot'),
      toeL: b('J_Bip_L_ToeBase'), toeR: b('J_Bip_R_ToeBase'),
      armL: b('J_Bip_L_UpperArm'), armR: b('J_Bip_R_UpperArm'),
      foreL: b('J_Bip_L_LowerArm'), foreR: b('J_Bip_R_LowerArm'),
    };
    // rest pose: arms keep their posed z (from poseVRM), x = 0 everywhere
    this.rest = {};
    for (const k in this.bones) {
      const bone = this.bones[k];
      if (bone) this.rest[k] = bone.rotation.clone();
    }
    // Stride geometry: measure the hip-joint -> ankle length on the fitted
    // model (falls back to the measured constant if the bones are missing).
    // A full cycle (2 steps) covers 2 * stepLength, and
    // stepLength = 2 * legLen * sin(hipAmp), so:
    //   phasePerUnit = 2*PI / (2 * stepLength) = PI / (2*L*sin(hipAmp)).
    let legLen = LEG_LEN_FALLBACK;
    try {
      model.updateMatrixWorld(true);
      const hj = this.bones.legL, an = this.bones.footL;
      if (hj && an) {
        const a = new THREE.Vector3(), c = new THREE.Vector3();
        hj.getWorldPosition(a); an.getWorldPosition(c);
        const m = a.y - c.y;
        if (m > 0.2 && m < 2) legLen = m;
      }
    } catch (e) { /* keep the fallback */ }
    this._legLen = legLen;
    this._phasePerUnit = Math.PI / (2 * legLen * Math.sin(HIP_AMP));
    this._speedFactor = 0;            // eased 0..1, scales the forward lean
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
      const ox = this.model.position.x, oz = this.model.position.z;
      const step = this.speed * mag * dt;
      this.model.position.x = clamp(this.model.position.x + mx * step, this.bounds.minX, this.bounds.maxX);
      this.model.position.z = clamp(this.model.position.z + mz * step, this.bounds.minZ, this.bounds.maxZ);
      // model faces -Z at ry=0, so facing for direction (mx,mz) is atan2(-mx,-mz)
      const want = Math.atan2(-mx, -mz);
      this.facing = lerpAngle(this.facing, want, Math.min(1, dt * 10));
      this.model.rotation.y = this.facing;
      // Stride-matched stepping: advance the cycle by the distance ACTUALLY
      // travelled this frame (after bounds clamping), so foot speed matches
      // ground speed and the feet don't slide. Slower input (joystick tilt,
      // tap-to-move approach) automatically slows the cadence.
      const dist = Math.hypot(this.model.position.x - ox, this.model.position.z - oz);
      this.phase += dist * this._phasePerUnit;
    }
    // ease the walk pose in/out
    const goal = this.moving ? 1 : 0;
    this.walkAmount += (goal - this.walkAmount) * Math.min(1, dt * 8);
    if (!this.moving && this.walkAmount < 0.02) this.walkAmount = 0;
    // ease the speed factor (forward lean) so it never pops on stop/start
    this._speedFactor += ((this.moving ? mag : 0) - this._speedFactor) * Math.min(1, dt * 4);
    this._pose();
    return this.moving;
  }

  _pose() {
    const w = this.walkAmount;
    const p = this.phase;
    const B = this.bones, R = this.rest;
    // every animated axis is rest + offset * walkAmount, so at w = 0 the
    // standing pose is EXACTLY the rest pose
    const setX = (bone, rest, x) => { if (bone && rest) bone.rotation.x = rest.x + x * w; };
    const setXY = (bone, rest, x, y) => {
      if (!bone || !rest) return;
      bone.rotation.x = rest.x + x * w;
      bone.rotation.y = rest.y + y * w;
    };
    const setXYZ = (bone, rest, x, y, z) => {
      if (!bone || !rest) return;
      bone.rotation.x = rest.x + x * w;
      bone.rotation.y = rest.y + y * w;
      bone.rotation.z = rest.z + z * w;
    };

    const s = Math.sin(p), c = Math.cos(p);
    const waveL = hipWave(p);         // +1: left leg max forward (heel-strike)
    const waveR = -waveL;
    const lean = 0.5 + 0.5 * this._speedFactor; // forward lean grows with speed

    // ---- legs: hips swing front/back (+ a touch of step width: the swing
    // foot drifts slightly outward so the legs stay distinct from behind) ----
    const hipL = HIP_AMP * waveL, hipR = HIP_AMP * waveR;
    // swing factor: 0 in stance, peaks mid-swing (shared by knee + step width)
    const swingFor = (ph) => Math.pow(Math.max(0, Math.cos(ph + KNEE_SHIFT)), 1.2);
    const swL = swingFor(p), swR = swingFor(p + Math.PI);
    setXYZ(B.legL, R.legL, hipL, 0, -STEP_WIDTH * swL);
    setXYZ(B.legR, R.legR, hipR, 0, STEP_WIDTH * swR);

    // ---- knees: flex during swing-through, near-straight at heel-strike
    // and during stance (plus a small loading-response flex just after
    // heel-strike). Flexion is NEGATIVE x on this rig — positive x bends
    // the knee forward (hyperextension), which is what v1 did.
    // NOTE: sin(2*ph - PI) has TWO positive lobes per cycle; the gate
    // (sin(ph) > 0) keeps the loading bump on the stance lobe only —
    // without it the bump fired during swing too and over-flexed the knee
    // to 1.04 rad, lifting the swing foot far too high.
    const kneeFor = (ph) => -(KNEE_SWING * swingFor(ph)
      + KNEE_STANCE * Math.max(0, Math.sin(2 * ph - Math.PI)) * (Math.sin(ph) > 0 ? 1 : 0));
    const kneeL = kneeFor(p), kneeR = kneeFor(p + Math.PI);
    setX(B.kneeL, R.kneeL, kneeL);
    setX(B.kneeR, R.kneeR, kneeR);

    // ---- hips: yaw with the stride, roll sway, lean + tiny pitch wobble ----
    // (computed before the ankles: the ankle compensation needs the hip pitch)
    const hipPitch = -0.02 * lean + 0.015 * Math.sin(2 * p);
    setXYZ(B.hips, R.hips, hipPitch, -HIP_YAW * s, HIP_ROLL * c);

    // ---- ankles: keep the foot level in world space (compensate the hip +
    // knee pitch), then add the gait shape: toes up at heel-strike, toes
    // down (heel up) at push-off. Foot world pitch ends up = footShape.
    const footShape = (ph) => {
      const u = -Math.sin(ph); // +1 at toe-off, -1 at heel-strike
      return u > 0 ? -FOOT_TOEOFF * Math.pow(u, 1.2) : -FOOT_HEEL * u;
    };
    setX(B.footL, R.footL, -(hipL + kneeL + hipPitch) + footShape(p));
    setX(B.footR, R.footR, -(hipR + kneeR + hipPitch) + footShape(p + Math.PI));

    // ---- toes: stay on the ground while the heel rises at push-off ----
    const toeFor = (ph) => TOE_FLEX * Math.pow(Math.max(0, -Math.sin(ph)), 1.5);
    setX(B.toeL, R.toeL, toeFor(p));
    setX(B.toeR, R.toeR, toeFor(p + Math.PI));

    // ---- spine/chest: counter-rotate against the hips; lean forward ----
    setXYZ(B.spine, R.spine, -0.035 * lean, SPINE_YAW * s, 0);
    setXYZ(B.chest, R.chest, -0.03 * lean, CHEST_YAW * s, 0);
    setXYZ(B.upperChest, R.upperChest, -0.02 * lean, UPPER_YAW * s, 0);
    setX(B.head, R.head, 0.05 * lean); // head tilts back slightly: gaze stays level

    // ---- arms: swing opposite to the same-side leg; elbows gently bent,
    // bending a little more as the arm swings forward ----
    setX(B.armL, R.armL, -ARM_SWING * waveL);
    setX(B.armR, R.armR, -ARM_SWING * waveR);
    const flexL = ELBOW_BASE + ELBOW_VAR * Math.max(0, -waveL);
    const flexR = ELBOW_BASE + ELBOW_VAR * Math.max(0, -waveR);
    setXY(B.foreL, R.foreL, ELBOW_X * flexL, -ELBOW_Y * flexL);
    setXY(B.foreR, R.foreR, ELBOW_X * flexR, ELBOW_Y * flexR);

    // ---- hips bob: lowest at double support (legs apart), highest at
    // passing (stance leg vertical). The drop is the geometric one — the
    // leg shortens by L*(1-cos(angle)) as it angles away from vertical —
    // scaled by BOB_FACTOR so the bounce stays lively, not springy.
    const drop = this._legLen * (1 - Math.cos(HIP_AMP * Math.abs(waveL))) * BOB_FACTOR;
    this.model.position.y = this.baseY - drop * w;
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
// onNPCTap(nx, ny) [v1.2, optional]: called first with the tap's normalized
// device coords (-1..1); returns true when the tap hit an NPC and was
// handled (profile opened) — then tap-to-move is skipped for that tap.
function createInput(joystickEl, knobEl, canvasEl, camera, onTap, onNPCTap) {
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
  // v1.2: after a touch tap, the browser fires a synthetic mouse click at
  // the same point — and by then the profile scrim covers that point, so
  // the synthetic click would close the sheet the tap just opened. When a
  // tap opens an NPC profile we cancel the touchend, which suppresses the
  // whole synthetic mouse sequence. (The sheet also has a 400ms guard as a
  // fallback for browsers that order the events differently.)
  let suppressNextTouchEnd = false;
  canvasEl.addEventListener('pointerdown', (e) => { downAt = Date.now(); downX = e.clientX; downY = e.clientY; suppressNextTouchEnd = false; });
  canvasEl.addEventListener('pointerup', (e) => {
    if (Date.now() - downAt > 350) return; // it was a drag, not a tap
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return;
    const r = canvasEl.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    // v1.2: NPCs first — a tap on a character opens their profile and the
    // player does NOT walk; only taps that miss every NPC move the player.
    if (onNPCTap && onNPCTap(nx, ny)) { suppressNextTouchEnd = true; return; }
    RAY.setFromCamera({ x: nx, y: ny }, camera);
    const hit = new THREE.Vector3();
    if (RAY.ray.intersectPlane(PLANE, hit)) onTap({ x: hit.x, z: hit.z });
  });
  // v1.2: cancel the touchend after an NPC tap so the browser does NOT
  // synthesize a mouse click onto the scrim that just appeared. Non-passive
  // on purpose — preventDefault needs it. (pointerup fires before touchend,
  // so the flag above is already set when this runs.)
  canvasEl.addEventListener('touchend', (e) => {
    if (suppressNextTouchEnd) { suppressNextTouchEnd = false; e.preventDefault(); }
  }, { passive: false });

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
