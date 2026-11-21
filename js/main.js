// Suli Anime v1.5 — SPA controller.
// One render loop runs at a time: switching screens stops the previous
// screen's loop and starts the new one. 3D screens init lazily on first
// visit (each loads the kaito VRM once; the browser cache makes later
// loads fast). No network use beyond the local files.
// v1.2 adds the village social feature: tap an NPC to open their profile
// (like / add friend / scripted chat), all stored in localStorage.
// v1.3 adds character editing: (A) creator colors (hair/skin/eyes/outfit)
// change the 3D model live and persist per character; (B) the player edits
// his own profile (kaito) from the account screen — NPC profiles are
// read-only. Saved appearance is applied everywhere a character appears.
// v1.4 adds the detailed village: procedural machiya/shop/minka buildings,
// torii gate, stone plaza/paths and props (env.js), plus circle colliders
// resolved in the walk loop so the player cannot walk through buildings.
// v1.5 adds switchable BIG MAPS (a data-driven registry of map modules —
// map-a.js «الساحة المركزية» first; B/C/D join by import + one line) and
// the SHOP ECONOMY (shopUI): coins with a daily bonus, an inventory, and
// buy/sell/apply — plus gifts for NPCs (from the profile sheet) that raise
// their like count. No player-to-player trading (needs multiplayer).
// v1.5.1 ships maps A + B; the picker lists the maps in the registry.
// v1.6 adds the ACCOUNT GATE (realistic world, phase 1): on first launch
// the player creates their OWN account (name, username, password, age,
// gender, appearance) before entering the world; on later visits they log
// in. Age 18+ is enforced at signup — under 18 the account is not created
// and entry is blocked. The player model follows the account's gender:
// male = the Dero VRM (as before), female = the articulated code-built
// avatar (characters-v4.js), driven by the same Player walk class.
// Passwords are SHA-256 hashed (account.js) — never stored in plaintext.
// No sexual content anywhere: this is a clean social world for adults.
import * as THREE from 'three';
import { loadVRM, poseVRM, fitVRM, baseRenderer, shadowDisc, buildCreatorEnv, buildHomeEnv, storedQuality, setStoredQuality, resolveQuality } from './env.js';
import { Player, FollowCamera, FixedCamera, createInput } from './player.js';
import { buildCharacter, fitHeight, buildArticulatedFemale, tintArticulated } from './characters-v4.js';
import { PROFILES, getProfile, saveProfileOverride, resetProfileOverride } from './profiles.js';
import { getAppearance, getStoredAppearance, saveAppearance, diffAppearance, tintVRM } from './appearance.js';
import { accountStore, validateSignup } from './account.js';
// v1.5: map modules — one import per shipped map (A + B in 1.5.1).
import { MAP as MAP_A } from './map-a.js';
import { MAP as MAP_B } from './map-b.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ---------- v1.6: player model selection (by account gender) ----------
// Male = the Dero VRM (as before); female = the articulated code-built
// avatar (characters-v4.js), which the Player walk class drives
// unchanged (same bone names, same -Z forward). The 'kaito' appearance
// slot is the PLAYER slot regardless of gender (kept for save
// compatibility). Screens that need a model only init after enterWorld(),
// so an account always exists by then; 'm' is the pre-login fallback.
function playerGender() {
  const a = accountStore.get();
  return a ? a.gender : 'm';
}
// Loads the player model ready to place: VRM = posed + fitted + tinted
// (as before); female avatar = built with the saved colors + fitted.
async function buildPlayerModel(targetHeight, groundY) {
  if (playerGender() === 'f') {
    const av = buildArticulatedFemale(getAppearance('kaito'));
    fitHeight(av, targetHeight, groundY);
    return av;
  }
  const av = await loadVRM('dero.vrm');
  poseVRM(av);
  fitVRM(av, targetHeight, groundY);
  tintVRM(av, getStoredAppearance('kaito'));
  return av;
}
// Re-tint the live player model with the SAVED appearance (after a shop
// theme is applied). VRM: tintVRM with stored overrides only (the VRM
// textures carry color). Female avatar: tintArticulated with the merged
// colors (its materials ARE the colors — no texture to preserve).
function tintPlayerModel(model) {
  if (playerGender() === 'f') tintArticulated(model, getAppearance('kaito'));
  else tintVRM(model, getStoredAppearance('kaito'));
}

// ---------- toast ----------
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- loading overlay helpers ----------
function loadError(loadEl, retry) {
  loadEl.innerHTML = '<b>تعذّر التحميل</b><p>تأكد من أن الخادم المحلي يعمل وأن ملف النموذج موجود، ثم أعد المحاولة</p><button class="btn">إعادة المحاولة</button>';
  loadEl.querySelector('.btn').addEventListener('click', () => {
    loadEl.innerHTML = '<div class="spin"></div><b>جارٍ التحميل</b><p>لحظات فقط</p>';
    retry();
  });
}

// ---------- generic 3D screen base ----------
// Every 3D screen: { init(), start(), stop(), resize() }. init() runs once
// (lazy, when first shown); start()/stop() control its requestAnimationFrame.
function makeLoop() {
  let raf = 0;
  const clock = new THREE.Clock();
  return {
    start(fn) {
      if (raf) return;
      clock.getDelta();
      const tick = () => {
        raf = requestAnimationFrame(tick);
        fn(Math.min(clock.getDelta(), 0.1));
      };
      tick();
    },
    stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    get running() { return !!raf; },
  };
}

// ================= HOME: welcome + live kaito preview =================
const homeScreen = (() => {
  let ready = false, initPromise = null, renderer, scene, camera, model, loop = makeLoop(), spin = 0;
  async function init() {
    if (ready) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const vp = $('#homeVp');
      const w = vp.clientWidth, h = vp.clientHeight;
      renderer = baseRenderer(vp, w, h, true);
      scene = new THREE.Scene();
      buildCreatorEnv(scene);
      camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 60);
      camera.position.set(0.25, 1.35, 2.9);
      camera.lookAt(0, 1.05, 0);
      try {
        model = await buildPlayerModel(1.6, 0.22); // v1.6: VRM (male) or articulated avatar (female)
      } catch (e) {
        loadError($('#homeLoad'), () => { initPromise = null; init().then(() => homeScreen.start()).catch(() => {}); });
        throw e;
      }
      // v1.6: buildPlayerModel already posed + fitted + tinted the model
      model.rotation.y = Math.PI - 0.45;
      scene.add(model);
      $('#homeLoad').classList.add('hidden');
      ready = true;
      window.__suli.ready.home = true;
      window.__done = true;
    })();
    return initPromise;
  }
  return {
    init,
    start() {
      if (!ready) return;
      loop.start((dt) => {
        if (model) { spin += dt * 0.35; model.rotation.y = Math.PI - 0.45 + spin; }
        renderer.render(scene, camera);
      });
    },
    stop() { loop.stop(); },
    resize() {
      if (!ready) return;
      const vp = $('#homeVp');
      camera.aspect = vp.clientWidth / vp.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(vp.clientWidth, vp.clientHeight);
    },
  };
})();

// ================= MAP REGISTRY (v1.5) =================
// One entry per shipped map module. Adding a map later = import its module
// above + one line in MAPS below; nothing else changes — the village screen
// reads env/bounds/start/title from the selected entry, and the picker
// (mapUI) renders MAPS as-is. The selection persists in localStorage
// ('suli-map'); an unknown stored id falls back to the first map.
const MAPS = [MAP_A, MAP_B];
const MAP_KEY = 'suli-map';
function selectedMapId() {
  try {
    const id = localStorage.getItem(MAP_KEY);
    if (id && MAPS.some((m) => m.id === id)) return id;
  } catch (e) {}
  return MAPS[0].id;
}
function selectedMap() {
  return MAPS.find((m) => m.id === selectedMapId()) || MAPS[0];
}
// The map for this session (fixed at load; switching saves + reloads).
const ACTIVE_MAP = selectedMap();

// ================= WALKABLE SCREEN factory (village + room) =================
function makeWalkScreen(opts) {
  let ready = false, initPromise = null, hintHidden = false;
  let renderer, scene, camera, player, camFollow, input, disc, av, loop = makeLoop();
  let npcs = null; // v1.2: village NPC groups for tap-to-profile (room: none)
  let shops = null; // v1.5: village shop groups for tap-to-shop (room: none)
  let colliders = null, envStats = null; // v1.4: village circle colliders + stats (room: none)
  let camManualYaw = null; // v1.4.1: drag-to-rotate — null = follow mode
  // (camera swings behind the player); once the user drags the camera, the
  // chosen yaw is held — FollowCamera.update would otherwise lerp it back
  // toward the player's facing every frame.
  const npcRay = new THREE.Raycaster();
  // v1.2: raycast the NPC groups for a tap (normalized device coords).
  // On a hit, open that character's profile and return true so the tap does
  // NOT also move the player. Walks up from the hit mesh to the group
  // carrying userData.npcKey (the hit may be a body mesh or the invisible
  // hit cylinder). Defined here so it can use this screen's camera.
  function pickNPC(nx, ny) {
    if (!npcs || !npcs.length) return false;
    npcRay.setFromCamera({ x: nx, y: ny }, camera);
    const hits = npcRay.intersectObjects(npcs.map((n) => n.group), true);
    if (!hits.length) return false;
    let o = hits[0].object;
    while (o && !o.userData.npcKey) o = o.parent;
    if (!o) return false;
    player.cancelTarget();
    socialUI.openProfile(o.userData.npcKey);
    return true;
  }
  // v1.5: raycast the SHOP groups for a tap (same pattern as pickNPC).
  // On a hit, open that shop's sheet and return true so the tap does NOT
  // also move the player. NPCs are tried first (see the input callback),
  // so a tap that hits both an NPC and a shop opens the NPC profile.
  function pickShop(nx, ny) {
    if (!shops || !shops.length) return false;
    npcRay.setFromCamera({ x: nx, y: ny }, camera);
    const hits = npcRay.intersectObjects(shops.map((s) => s.group), true);
    if (!hits.length) return false;
    let o = hits[0].object;
    while (o && !o.userData.shopId) o = o.parent;
    if (!o) return false;
    player.cancelTarget();
    shopUI.openShop(o.userData.shopId);
    return true;
  }
  async function init() {
    if (ready) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const vp = $(opts.vp);
      const w = vp.clientWidth, h = vp.clientHeight;
      renderer = baseRenderer(vp, w, h, false);
      scene = new THREE.Scene();
      const envHandles = opts.env(scene) || {}; // village returns { npcs, shops, colliders, stats }
      if (envHandles.npcs) npcs = envHandles.npcs;
      if (envHandles.shops) shops = envHandles.shops; // v1.5: tappable shops
      if (envHandles.colliders) colliders = envHandles.colliders;
      if (envHandles.stats) envStats = envHandles.stats;
      camera = new THREE.PerspectiveCamera(opts.fov || 46, w / h, 0.1, 80);
      try {
        av = await buildPlayerModel(1.45, 0); // v1.6: VRM (male) or articulated avatar (female)
      } catch (e) {
        loadError($(opts.load), () => { initPromise = null; init().then(() => api.start()).catch(() => {}); });
        throw e;
      }
      // v1.6: buildPlayerModel already posed + fitted + tinted the model
      // v1.4.1: the player casts a real shadow on high quality (opaque
      // meshes only — a transparent mesh would cast a solid blob).
      av.traverse((o) => { if (o.isMesh && !(o.material && o.material.transparent)) o.castShadow = true; });
      // v1.4.2: no name label above the player — removed on the user's
      // request ("lvitas"). Name + level still show in the profile
      // sheet, the account screen and the creator.
      scene.add(av);
      player = new Player(av, opts.bounds, opts.start);
      disc = shadowDisc(opts.start.x, opts.start.z, 0.45, 0.045);
      scene.add(disc);
      if (opts.camMode === 'fixed') {
        camFollow = new FixedCamera(camera, opts.camPos, opts.camLook);
      } else {
        camFollow = new FollowCamera(camera, opts.camDist, opts.camHeight);
      }
      camFollow.snapTo(player);
      input = createInput($(opts.joy), $(opts.knob), renderer.domElement, camera,
        (pt) => player.setTarget(pt.x, pt.z),
        // v1.2: NPC taps first; v1.5: then shop taps — a tap that hits
        // neither moves the player (player.js is untouched: one callback).
        (npcs || shops) ? (nx, ny) => pickNPC(nx, ny) || pickShop(nx, ny) : undefined);
      // v1.4.1: drag-to-rotate the follow camera (village only — the room's
      // FixedCamera has no yaw). Dragging on empty canvas orbits the camera
      // around Kaito; the new angle persists until the next drag. A short
      // press (<10px) is still a tap — tap-to-move and NPC taps are handled
      // by player.js on pointerup (its own 12px threshold), and drags that
      // start on the joystick never reach the canvas (separate element), so
      // walking is unaffected. Touch + mouse both come through as pointer
      // events; the .vp CSS already sets touch-action:none so a touch drag
      // is not hijacked by scrolling.
      if (camFollow instanceof FollowCamera) {
        const cv = renderer.domElement;
        const DRAG_THRESHOLD = 10; // px of movement before a press becomes a drag
        const DRAG_SENS = 0.005;   // camera yaw radians per px of horizontal drag
        let drag = null; // { id, lastX, lastY, moved }
        cv.addEventListener('pointerdown', (e) => {
          if (drag) return; // single-pointer only
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          drag = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY, moved: 0 };
          try { cv.setPointerCapture(e.pointerId); } catch (err) { /* no capture — the drag still works while the pointer stays over the canvas */ }
        });
        cv.addEventListener('pointermove', (e) => {
          if (!drag || e.pointerId !== drag.id) return;
          const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
          drag.lastX = e.clientX; drag.lastY = e.clientY;
          drag.moved += Math.hypot(dx, dy);
          if (drag.moved < DRAG_THRESHOLD) return;
          if (camManualYaw === null) camManualYaw = camFollow.yaw;
          camManualYaw -= dx * DRAG_SENS; // drag right -> camera turns right (view pans right)
          camFollow.yaw = camManualYaw;
        });
        const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
        cv.addEventListener('pointerup', endDrag);
        cv.addEventListener('pointercancel', endDrag);
      }
      $(opts.load).classList.add('hidden');
      ready = true;
      window.__suli.ready[opts.name] = true;
    })();
    return initPromise;
  }
  const api = {
    init,
    start() {
      if (!ready) return;
      // the control hint fades out after a few seconds (first visit only)
      if (!hintHidden) {
        hintHidden = true;
        setTimeout(() => {
          const h = document.querySelector(opts.vp + ' .hint');
          if (h) h.style.opacity = '0';
        }, 8000);
      }
      loop.start((dt) => {
        const dir = input.worldDir(camFollow);
        player.update(dt, dir);
        // v1.4: circle colliders (buildings/props) — push the player out to
        // the edge and cancel tap-to-move so they stop instead of walking
        // in place against the obstacle. Player walk code untouched.
        if (colliders) {
          for (const c of colliders) {
            const dx = player.position.x - c.x, dz = player.position.z - c.z;
            const d = Math.hypot(dx, dz);
            if (d < c.r) {
              if (d < 1e-4) { player.position.x = c.x + c.r; }
              else { player.position.x = c.x + dx / d * c.r; player.position.z = c.z + dz / d * c.r; }
              player.cancelTarget();
            }
          }
        }
        // v1.5: re-clamp after the collider push — a push near a bound can
        // eject the player ~0.2 past the bound line (found by the map-B
        // builder); Player.update clamps BEFORE the push, so clamp again.
        player.position.x = Math.max(opts.bounds.minX, Math.min(opts.bounds.maxX, player.position.x));
        player.position.z = Math.max(opts.bounds.minZ, Math.min(opts.bounds.maxZ, player.position.z));
        camFollow.update(dt, player);
        // v1.4.1: hold the user's chosen camera angle. FollowCamera.update
        // lerps yaw back toward the player's facing, so re-apply the manual
        // yaw after it; _apply's position lerp keeps the motion smooth.
        // (At very low fps the double _apply biases the camera a few
        // degrees toward the facing direction — negligible on a real phone.)
        if (camManualYaw !== null && camFollow instanceof FollowCamera) {
          camFollow.yaw = camManualYaw;
          camFollow._apply(player, Math.min(1, dt * 6));
        }
        disc.position.x = player.position.x;
        disc.position.z = player.position.z;
        renderer.render(scene, camera);
      });
    },
    stop() { loop.stop(); },
    resize() {
      if (!ready) return;
      const vp = $(opts.vp);
      camera.aspect = vp.clientWidth / vp.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(vp.clientWidth, vp.clientHeight);
    },
    playerPos() { return ready ? { x: player.position.x, z: player.position.z } : null; },
    isReady() { return ready; },
    // v1.4.1 test hook: follow-camera yaw in radians (village only; null
    // in the room / before init)
    cameraYaw() { return ready && camFollow instanceof FollowCamera ? camFollow.yaw : null; },
    // v1.4.1 test hooks: Kaito's on-screen height (fraction of the viewport
    // height, feet y=0 to head y≈1.45) + camera position + renderer quality
    kaitoSpan() {
      if (!ready) return null;
      const p = player.position;
      const top = new THREE.Vector3(p.x, p.y + 1.45, p.z).project(camera);
      const bot = new THREE.Vector3(p.x, p.y, p.z).project(camera);
      return Math.abs(top.y - bot.y) / 2; // NDC spans -1..1 = full viewport height
    },
    cameraPos() { return ready ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null; },
    quality() {
      if (!ready) return null;
      const attrs = renderer.getContext().getContextAttributes();
      return { pixelRatio: renderer.getPixelRatio(), shadows: renderer.shadowMap.enabled, antialias: !!(attrs && attrs.antialias) };
    },
    // v1.4 test hooks: render stats + village inventory (colliders/stats)
    perf() {
      if (!ready) return null;
      return { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
    },
    info() { return ready ? { colliders: colliders ? colliders.length : 0, stats: envStats } : null; },
    // v1.2 test hooks (same family as playerPos): project a world point to
    // page pixels, for automated tap tests. visible is false when the point
    // is outside the current camera view.
    groundScreen(x, z) {
      if (!ready) return null;
      const v = new THREE.Vector3(x, 0, z);
      v.project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return {
        x: r.left + (v.x + 1) / 2 * r.width,
        y: r.top + (1 - v.y) / 2 * r.height,
        visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
      };
    },
    npcScreen(key) {
      if (!ready || !npcs) return null;
      const n = npcs.find((o) => o.key === key);
      if (!n) return null;
      const v = new THREE.Vector3();
      n.group.getWorldPosition(v);
      v.y = 1.0;
      v.project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return {
        x: r.left + (v.x + 1) / 2 * r.width,
        y: r.top + (1 - v.y) / 2 * r.height,
        visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
      };
    },
    // v1.5 test hook: project a SHOP to page pixels (same family as
    // npcScreen), for automated tap-to-shop tests.
    shopScreen(id) {
      if (!ready || !shops) return null;
      const s = shops.find((o) => o.id === id);
      if (!s) return null;
      const v = new THREE.Vector3();
      s.group.getWorldPosition(v);
      v.y = 1.2;
      v.project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return {
        x: r.left + (v.x + 1) / 2 * r.width,
        y: r.top + (1 - v.y) / 2 * r.height,
        visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
      };
    },
    // v1.5: re-tint the player model with the SAVED appearance (after a
    // shop theme is applied) so the new colors show without a reload.
    // v1.6: branches on gender (VRM tint vs articulated-avatar tint).
    applyAppearance() {
      if (!ready || !av) return;
      tintPlayerModel(av);
    },
  };
  return api;
}

const villageScreen = makeWalkScreen({
  name: 'village', vp: '#villageVp', load: '#villageLoad', joy: '#joyVillage', knob: '#knobVillage',
  env: ACTIVE_MAP.buildEnv, // v1.5: env/bounds/start come from the selected map
  bounds: ACTIVE_MAP.bounds,
  start: ACTIVE_MAP.start,
  // v1.4.1: closer follow camera (was 4.6) — Kaito reads bigger and
  // sharper on the phone. Height unchanged (2.7), so the camera still
  // passes under the torii beams (y 2.95/3.42).
  camDist: 3.4, camHeight: 2.7,
});
const roomScreen = makeWalkScreen({
  name: 'room', vp: '#roomVp', load: '#roomLoad', joy: '#joyRoom', knob: '#knobRoom',
  env: buildHomeEnv,
  bounds: { minX: -4.6, maxX: 4.6, minZ: -3.2, maxZ: 3.4 },
  start: { x: -0.2, z: 0.6, ry: 0 }, // facing -Z, toward the back wall
  camMode: 'fixed', fov: 55,
  camPos: { x: 0, y: 4.1, z: 6.8 },
  camLook: { x: 0, y: 0.8, z: -0.5 },
});

// ================= CREATOR =================
const TICK = '<span class="tk"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>';
const CHAR_NAMES = { kaito: 'كايتو', yusuf: 'يوسف', sara: 'سارة', layan: 'ليان' };

const creatorScreen = (() => {
  let ready = false, initPromise = null;
  let renderer, scene, camera, group, loop = makeLoop(), spin = 0;
  let currentChar = 'kaito', currentModel = null, kaitoModel = null;
  const state = loadSaved() || {
    char: 'kaito', name: 'كايتو', gender: 'm', height: 175, athletic: true,
    hairstyle: 'short', haircolor: '#4a2c2a', face: 'round',
    eyecolor: '#4a2c2a', eyeshape: 'big', build: 'medium',
    outfit: 'hoodie-white', outfitcolor: '#f5f5f5', skin: '#ffd9b3',
  };
  if (!state.outfitcolor) state.outfitcolor = '#f5f5f5'; // v1.3: old saves

  function loadSaved() {
    try {
      const raw = localStorage.getItem('suli-character');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function applyScale() {
    if (!group) return;
    const hs = 0.9 + ((state.height - 150) / 45) * 0.2; // 150cm -> 0.9, 195cm -> 1.1
    const w = state.athletic ? 1.05 : 1;
    group.scale.set(hs * w, hs, hs * w);
  }

  // v1.3: `appOverride` (live, unsaved colors from the dots) previews
  // colors without saving; without it the SAVED appearance is applied, so
  // switching characters always resets the preview to what is saved.
  async function setPreviewChar(key, appOverride) {
    currentChar = key;
    state.char = key;
    if (currentModel) { group.remove(currentModel); currentModel = null; }
    if (key === 'kaito') {
      // v1.6: the player card shows the PLAYER's model — the VRM for a
      // male account, the articulated female avatar for a female account.
      if (playerGender() === 'f') {
        currentModel = buildArticulatedFemale(appOverride || getAppearance('kaito'));
        fitHeight(currentModel, 1.55, 0.22);
      } else {
        if (!kaitoModel) {
          kaitoModel = await loadVRM('dero.vrm');
          poseVRM(kaitoModel);
          fitVRM(kaitoModel, 1.55, 0.22);
        }
        currentModel = kaitoModel;
        tintVRM(currentModel, appOverride ? diffAppearance(key, appOverride) : getStoredAppearance(key));
      }
    } else {
      currentModel = buildCharacter(key, appOverride || getAppearance(key));
      fitHeight(currentModel, 1.55, 0.22);
    }
    currentModel.rotation.y = Math.PI - 0.45;
    group.add(currentModel);
    applyScale();
    // picker UI
    $$('.pick').forEach((p) => {
      const on = p.dataset.char === key;
      p.classList.toggle('on', on);
      const tk = p.querySelector('.tk');
      if (on && !tk) p.insertAdjacentHTML('afterbegin', TICK.replace('width="14" height="14"', 'width="12" height="12"'));
      if (!on && tk) tk.remove();
    });
  }

  // v1.3: the four live colors, as currently picked in the creator.
  function currentColors() {
    return { haircolor: state.haircolor, skin: state.skin, eyecolor: state.eyecolor, outfitcolor: state.outfitcolor };
  }
  // v1.5: shop themes the player OWNS appear as extra color dots in the
  // creator (hair + outfit groups), so a bought theme can be picked here
  // like any built-in color. Dots are rebuilt from the inventory every
  // time (stale ones removed first); a theme whose color already has a
  // built-in dot is skipped. The delegated [data-group] click handler
  // picks these dots up automatically (no extra wiring).
  function refreshShopDots() {
    const inv = shopUI.inventory();
    [['haircolor', 'hair'], ['outfitcolor', 'outfit']].forEach(function (pair) {
      const name = pair[0], kind = pair[1];
      const g = document.querySelector('[data-group="' + name + '"]');
      if (!g) return;
      g.querySelectorAll('.dot[data-shop]').forEach((d) => d.remove());
      Object.keys(inv).forEach(function (id) {
        const it = shopUI.ITEMS[id];
        if (!it || it.kind !== kind || inv[id] < 1) return;
        if (g.querySelector('.dot[data-v="' + it.color + '"]')) return;
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.dataset.v = it.color;
        dot.dataset.shop = id;
        dot.style.background = it.color;
        dot.title = it.name;
        g.appendChild(dot);
      });
      // re-mark the 'on' dot for the CURRENT state color (a shop color may
      // now have a dot that the saved-state sync below does not know about)
      g.querySelectorAll('.dot').forEach((o) => o.classList.toggle('on', o.dataset.v === String(state[name])));
    });
  }
  // v1.3: load a character's SAVED colors into the creator state + dots.
  function syncCreatorColors(key) {
    refreshShopDots(); // v1.5: owned themes first, so their dots can be 'on'
    const app = getAppearance(key);
    state.haircolor = app.haircolor;
    state.skin = app.skin;
    state.eyecolor = app.eyecolor;
    state.outfitcolor = app.outfitcolor;
    ['haircolor', 'skin', 'eyecolor', 'outfitcolor'].forEach((name) => {
      const g = document.querySelector('[data-group="' + name + '"]');
      if (!g) return;
      g.querySelectorAll('.dot').forEach((o) => o.classList.toggle('on', o.dataset.v === String(app[name])));
    });
  }
  // v1.3: a color dot was clicked — change the preview immediately
  // (unsaved until «حفظ الشخصية»).
  function applyLiveColors() {
    if (!currentModel) return;
    setPreviewChar(currentChar, currentColors()).catch(() => {});
  }

  function buildThumb(el, key) {
    const w = el.clientWidth, h = el.clientHeight;
    if (w < 10 || h < 10) return;
    const r = baseRenderer(el, w, h, true);
    const sc = new THREE.Scene();
    const av = buildCharacter(key, getAppearance(key));
    const s = fitHeight(av, 1.5, 0);
    av.rotation.y = -0.25;
    sc.add(av);
    const headY = 1.39 * s;
    const cam = new THREE.PerspectiveCamera(36, w / h, 0.1, 60);
    cam.position.set(0.10, headY + 0.02, 0.80);
    cam.lookAt(0, headY - 0.09, 0);
    sc.add(new THREE.HemisphereLight(0xffffff, 0xf3e7cf, 0.85));
    const dl = new THREE.DirectionalLight(0xfff2dd, 1.15);
    dl.position.set(4, 7, 4); sc.add(dl);
    r.render(sc, cam);
  }
  async function buildThumbVRM(el) {
    const w = el.clientWidth, h = el.clientHeight;
    if (w < 10 || h < 10) return;
    const r = baseRenderer(el, w, h, true);
    const sc = new THREE.Scene();
    // v1.6: the player thumb follows the account's gender too
    let av;
    if (playerGender() === 'f') {
      av = buildArticulatedFemale(getAppearance('kaito'));
      fitHeight(av, 1.5, 0);
    } else {
      av = await loadVRM('dero.vrm');
      poseVRM(av);
      fitVRM(av, 1.5, 0);
      tintVRM(av, getStoredAppearance('kaito')); // v1.3: saved colors
    }
    av.rotation.y = Math.PI - 0.25;
    sc.add(av);
    sc.updateMatrixWorld(true);
    const head = av.getObjectByName('J_Bip_C_Head');
    const hp = new THREE.Vector3();
    if (head) head.getWorldPosition(hp); else hp.set(0, 1.35, 0);
    const cam = new THREE.PerspectiveCamera(36, w / h, 0.1, 60);
    cam.position.set(0.10, hp.y + 0.02, 0.80);
    cam.lookAt(0, hp.y - 0.09, 0);
    sc.add(new THREE.HemisphereLight(0xffffff, 0xf3e7cf, 0.85));
    const dl = new THREE.DirectionalLight(0xfff2dd, 1.15);
    dl.position.set(4, 7, 4); sc.add(dl);
    r.render(sc, cam);
  }

  async function init() {
    if (ready) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const vp = $('#creatorPreview');
      const w = vp.clientWidth, h = vp.clientHeight;
      renderer = baseRenderer(vp, w, h, true);
      scene = new THREE.Scene();
      buildCreatorEnv(scene);
      group = new THREE.Group();
      scene.add(group);
      camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 60);
      camera.position.set(0.25, 1.32, 2.7);
      camera.lookAt(0, 1.0, 0);
      try {
        await setPreviewChar(state.char);
        syncCreatorColors(state.char); // v1.3: dots show the saved colors
        const thumbJobs = [];
        $$('.thumb3d').forEach((el) => {
          const key = el.dataset.char;
          if (key === 'kaito') thumbJobs.push(buildThumbVRM(el));
          else buildThumb(el, key);
        });
        await Promise.all(thumbJobs);
      } catch (e) {
        loadError($('#creatorLoad'), () => { initPromise = null; init().then(() => creatorScreen.start()).catch(() => {}); });
        throw e;
      }
      $('#creatorLoad').classList.add('hidden');
      ready = true;
      window.__suli.ready.creator = true;
    })();
    return initPromise;
  }

  // ---- creator UI wiring (runs once, independent of the 3D init) ----
  function wireUI() {
    // character picker
    $$('.pick').forEach((p) => p.addEventListener('click', () => {
      const key = p.dataset.char;
      if (key === currentChar) return;
      syncCreatorColors(key); // v1.3: dots show THIS character's saved colors
      setPreviewChar(key).catch(() => toast('تعذّر تحميل الشخصية'));
      // choosing a character sets the name field and the gender to its default
      // (v1.3: kaito's name comes from his edited profile, not the default)
      state.name = key === 'kaito' ? getProfile('kaito').name : CHAR_NAMES[key];
      $('#charName').value = state.name;
      state.gender = (key === 'sara' || key === 'layan') ? 'f' : 'm';
      $$('#genderSeg div').forEach((d) => d.classList.toggle('on', d.dataset.g === state.gender));
    }));
    // tabs
    $$('#creatorTabs .tab').forEach((t) => t.addEventListener('click', () => {
      $$('#creatorTabs .tab').forEach((x) => x.classList.toggle('on', x === t));
      $$('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === t.dataset.panel));
    }));
    // option groups (hairstyle, colors, face, eyes, build, outfit, skin)
    $$('[data-group]').forEach((g) => {
      const name = g.dataset.group;
      g.addEventListener('click', (e) => {
        const opt = e.target.closest('.opt, .dot');
        if (!opt || !g.contains(opt)) return;
        g.querySelectorAll('.opt, .dot').forEach((o) => {
          o.classList.remove('on');
          const tk = o.querySelector('.tk');
          if (tk) tk.remove();
        });
        opt.classList.add('on');
        if (opt.classList.contains('opt')) opt.insertAdjacentHTML('afterbegin', TICK);
        state[name] = opt.dataset.v;
        // v1.3: color choices change the 3D preview immediately
        if (name === 'haircolor' || name === 'skin' || name === 'eyecolor' || name === 'outfitcolor') {
          applyLiveColors();
        }
        // build choice mirrors the athletic switch
        if (name === 'build') {
          state.athletic = opt.dataset.v === 'sporty';
          $('#athleticSwitch').classList.toggle('on', state.athletic);
          applyScale();
        }
      });
    });
    // gender
    $$('#genderSeg div').forEach((d) => d.addEventListener('click', () => {
      $$('#genderSeg div').forEach((x) => x.classList.toggle('on', x === d));
      state.gender = d.dataset.g;
    }));
    // name
    $('#charName').addEventListener('input', (e) => { state.name = e.target.value.trim() || 'كايتو'; });
    // height slider -> preview scale + label
    $('#heightSlider').addEventListener('input', (e) => {
      state.height = parseInt(e.target.value, 10);
      $('#heightLabel').textContent = state.height + ' سم';
      applyScale();
    });
    // athletic switch -> preview width + build choice
    $('#athleticSwitch').addEventListener('click', () => {
      state.athletic = !state.athletic;
      $('#athleticSwitch').classList.toggle('on', state.athletic);
      state.build = state.athletic ? 'sporty' : 'medium';
      const bg = document.querySelector('[data-group="build"]');
      if (bg) {
        bg.querySelectorAll('.opt').forEach((o) => {
          const on = o.dataset.v === state.build;
          o.classList.toggle('on', on);
          const tk = o.querySelector('.tk');
          if (on && !tk) o.insertAdjacentHTML('afterbegin', TICK);
          if (!on && tk) tk.remove();
        });
      }
      applyScale();
    });
    // save
    $('#saveCharBtn').addEventListener('click', () => {
      try { localStorage.setItem('suli-character', JSON.stringify(state)); } catch (e) {}
      // v1.3: persist this character's colors (only changed fields stored)
      saveAppearance(state.char, currentColors());
      // v1.3: the creator name and the profile name are one identity — a
      // rename of kaito here follows into his profile (NPC names are
      // read-only, so this runs for kaito only).
      if (state.char === 'kaito') saveProfileOverride('kaito', { name: state.name || 'كايتو' });
      // v1.3: re-render this character's picker thumb with the new colors
      const thumbEl = document.querySelector('.thumb3d[data-char="' + state.char + '"]');
      if (thumbEl) {
        thumbEl.innerHTML = '';
        if (state.char === 'kaito') buildThumbVRM(thumbEl).catch(() => {});
        else buildThumb(thumbEl, state.char);
      }
      const nm = state.name || 'كايتو';
      $('#accName').textContent = nm;
      const heroName = $('#screen-home .name b');
      if (heroName) heroName.textContent = nm;
      toast('تم حفظ شخصيتك');
    });
    // restore saved state into the controls
    // restore saved name into account + home hero (not just the creator input)
    const acc = $('#accName');
    if (acc) acc.textContent = state.name || 'كايتو';
    const heroName = $('#screen-home .name b');
    if (heroName) heroName.textContent = state.name || 'كايتو';
    if (state.name) $('#charName').value = state.name;
    $('#heightSlider').value = state.height;
    $('#heightLabel').textContent = state.height + ' سم';
    $('#athleticSwitch').classList.toggle('on', !!state.athletic);
    $$('#genderSeg div').forEach((d) => d.classList.toggle('on', d.dataset.g === state.gender));
    $$('[data-group]').forEach((g) => {
      const v = state[g.dataset.group];
      if (v === undefined) return;
      g.querySelectorAll('.opt, .dot').forEach((o) => {
        const on = o.dataset.v === String(v);
        o.classList.toggle('on', on);
        const tk = o.querySelector('.tk');
        if (on && o.classList.contains('opt') && !tk) o.insertAdjacentHTML('afterbegin', TICK);
        if (!on && tk) tk.remove();
      });
    });
  }

  return {
    init,
    start() {
      if (!ready) return;
      refreshShopDots(); // v1.5: a theme bought since the last visit shows up
      loop.start((dt) => {
        if (group) { spin += dt * 0.3; group.rotation.y = spin; }
        renderer.render(scene, camera);
      });
    },
    stop() { loop.stop(); },
    resize() {
      if (!ready) return;
      const vp = $('#creatorPreview');
      camera.aspect = vp.clientWidth / vp.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(vp.clientWidth, vp.clientHeight);
    },
    wireUI,
    getState() { return state; },
    // v1.6: sync the creator's name + gender with the account (called on
    // login/signup). Only when the player card is selected — the other
    // cards keep their own character's name and gender.
    setPlayerName(name, gender) {
      if (state.char !== 'kaito') return;
      state.name = name;
      const input = $('#charName');
      if (input) input.value = name;
      if (gender) {
        state.gender = gender;
        $$('#genderSeg div').forEach((d) => d.classList.toggle('on', d.dataset.g === gender));
      }
    },
    // v1.3 test hook: the colors the current preview model shows.
    // Kaito (VRM): the tinted material colors. Code-built characters:
    // the colors the rebuild used (see appliedAppearance). v1.6: the
    // female player avatar is code-built too, so it takes the same path.
    debugMaterials() {
      if (!currentModel) return null;
      if (currentChar !== 'kaito' || playerGender() === 'f') {
        const a = currentModel.userData.appliedAppearance;
        return a ? { hair: a.haircolor, skin: a.skin, eye: a.eyecolor, outfit: a.outfitcolor } : null;
      }
      const out = {};
      currentModel.traverse((n) => {
        if (!n.isMesh && !n.isSkinnedMesh) return;
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        mats.forEach((m) => {
          if (!m || !m.name || !m.color) return;
          const hex = '#' + m.color.getHexString();
          if (m.name.indexOf('_HAIR') !== -1) out.hair = hex;
          else if (m.name.indexOf('_SKIN') !== -1) out.skin = hex;
          else if (m.name.indexOf('EyeIris') !== -1) out.eye = hex;
          else if (m.name.indexOf('_Tops_') !== -1) out.outfit = hex;
        });
      });
      return out;
    },
  };
})();

// ================= SHOPS + ECONOMY (v1.5) =================
// All local (localStorage) — no backend, no multiplayer yet. The shops are
// NPC vendors: the player buys from them and sells back to them at half
// price. Player-to-player trading needs multiplayer and is NOT in this
// version (the shops are the economy until multiplayer lands).
//   suli-coins: number (starting balance 500)
//   suli-last-daily: 'YYYY-MM-DD' of the last daily bonus (+100/day)
//   suli-inventory: { itemId: count } (themes: 0/1, gifts: any count)
//   suli-gift-likes: { npcKey: count } — likes earned by gifting
const shopUI = (() => {
  const COINS_KEY = 'suli-coins';
  const DAILY_KEY = 'suli-last-daily';
  const INV_KEY = 'suli-inventory';
  const GIFT_LIKES_KEY = 'suli-gift-likes';
  const START_COINS = 500;
  const DAILY_BONUS = 100;
  // Catalog: 4 shops x 3-4 items. Themes are EXCLUSIVE colors (not among
  // the creator's built-in dots) so buying them unlocks something new.
  // kind: 'outfit' | 'hair' (theme, applies to kaito) | 'gift' (consumable).
  // gift.fav: the NPC who loves it (+2 likes instead of +1).
  const ITEMS = {
    'theme-gold':   { id: 'theme-gold',   name: 'هودي ذهبي ملكي',    desc: 'لون زي ذهبي حصري',       price: 300, kind: 'outfit', color: '#d4af37', shop: 'fashion' },
    'theme-violet': { id: 'theme-violet', name: 'هودي بنفسجي الليل', desc: 'لون زي بنفسجي حصري',     price: 220, kind: 'outfit', color: '#8b5cf6', shop: 'fashion' },
    'theme-teal':   { id: 'theme-teal',   name: 'هودي فيروزي النهر',  desc: 'لون زي فيروزي حصري',     price: 200, kind: 'outfit', color: '#14b8a6', shop: 'fashion' },
    'hair-gold':    { id: 'hair-gold',    name: 'شعر ذهبي',          desc: 'لون شعر ذهبي حصري',     price: 250, kind: 'hair',   color: '#d4af37', shop: 'colors' },
    'hair-violet':  { id: 'hair-violet',  name: 'شعر بنفسجي',        desc: 'لون شعر بنفسجي حصري',   price: 180, kind: 'hair',   color: '#8b5cf6', shop: 'colors' },
    'hair-teal':    { id: 'hair-teal',    name: 'شعر فيروزي',        desc: 'لون شعر فيروزي حصري',   price: 180, kind: 'hair',   color: '#14b8a6', shop: 'colors' },
    'gift-cake':    { id: 'gift-cake',    name: 'كعكة فراولة',       desc: 'هدية — المفضلة لدى سارة', price: 80,  kind: 'gift', color: '#f472b6', fav: 'sara',  shop: 'gifts' },
    'gift-ball':    { id: 'gift-ball',    name: 'كرة قدم',           desc: 'هدية — المفضل لدى يوسف', price: 120, kind: 'gift', color: '#5e9a6a', fav: 'yusuf', shop: 'gifts' },
    'gift-brush':   { id: 'gift-brush',   name: 'فرشاة رسم',         desc: 'هدية — المفضلة لدى ليان', price: 100, kind: 'gift', color: '#8b7bb8', fav: 'layan', shop: 'gifts' },
    'gift-bouquet': { id: 'gift-bouquet', name: 'باقة ساكورا',       desc: 'هدية تناسب الجميع',       price: 60,  kind: 'gift', color: '#f2a0c0', fav: null,    shop: 'gifts' },
    'gift-apple':   { id: 'gift-apple',   name: 'تفاح الجبل',        desc: 'هدية من بساتين القرية',   price: 40,  kind: 'gift', color: '#c0392b', fav: null,    shop: 'farm' },
    'gift-honey':   { id: 'gift-honey',   name: 'عسل القرية',        desc: 'هدية حلوة من المنحل',     price: 50,  kind: 'gift', color: '#e8a33d', fav: null,    shop: 'farm' },
    'gift-tea':     { id: 'gift-tea',     name: 'شاي الأعشاب',       desc: 'هدية دافئة ومهدئة',       price: 45,  kind: 'gift', color: '#5e9a6a', fav: null,    shop: 'farm' },
    'gift-candy':   { id: 'gift-candy',   name: 'حلوى ساكورا',       desc: 'هدية صغيرة ولذيذة',       price: 30,  kind: 'gift', color: '#f8b8d0', fav: null,    shop: 'farm' },
  };
  const SHOPS = {
    fashion: { id: 'fashion', name: 'متجر الأزياء', desc: 'ألوان أزياء حصرية — اشترِها وطبّقها على شخصيتك، أو اخترها لاحقاً من المنشئ.', items: ['theme-gold', 'theme-violet', 'theme-teal'] },
    colors:  { id: 'colors',  name: 'متجر الألوان', desc: 'ألوان شعر حصرية لا توجد في المنشئ — اشترِها وطبّقها أو اخترها من المنشئ.', items: ['hair-gold', 'hair-violet', 'hair-teal'] },
    gifts:   { id: 'gifts',   name: 'متجر الهدايا', desc: 'هدايا لسكان القرية — أهدِها من بروفايل الشخصية ليرتفع إعجابها بك.', items: ['gift-cake', 'gift-ball', 'gift-brush', 'gift-bouquet'] },
    farm:    { id: 'farm',    name: 'سوق المزارع',  desc: 'من منتجات القرية: فواكه وعسل وشاي — كلها هدايا مناسبة لأي شخصية.', items: ['gift-apple', 'gift-honey', 'gift-tea', 'gift-candy'] },
  };

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- coins + inventory ----
  function coins() {
    const v = loadJSON(COINS_KEY, null);
    return (typeof v === 'number' && v >= 0) ? Math.floor(v) : START_COINS;
  }
  function setCoins(v) {
    saveJSON(COINS_KEY, Math.max(0, Math.floor(v)));
    renderCoins();
  }
  function inventory() {
    const v = loadJSON(INV_KEY, {});
    return (v && typeof v === 'object') ? v : {};
  }
  function renderCoins() {
    const txt = coins().toLocaleString('en-US') + ' عملة';
    const top = $('#topCoins');
    if (top) top.textContent = txt;
    const acc = $('#accCoins');
    if (acc) acc.textContent = coins().toLocaleString('en-US');
  }
  function dailyBonus() {
    const today = new Date().toISOString().slice(0, 10);
    if (loadJSON(DAILY_KEY, '') === today) return;
    saveJSON(DAILY_KEY, today);
    setCoins(coins() + DAILY_BONUS);
    toast('مكافأة يومية: +' + DAILY_BONUS + ' عملة');
  }

  // ---- shop sheet (same scrim-guard pattern as the profile sheet) ----
  let currentShop = null;
  let shopOpenedAt = 0;
  const GIFT_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4"/><path d="M5 12v8h14v-8"/><path d="M12 8v12"/><path d="M12 8s-4 0-4-2.5S12 3 12 8zM12 8s4 0 4-2.5S12 3 12 8z"/></svg>';
  function renderShop(id) {
    const shop = SHOPS[id];
    if (!shop) return;
    $('#shopName').textContent = shop.name;
    $('#shopDesc').textContent = shop.desc;
    $('#shopCoins').textContent = coins().toLocaleString('en-US') + ' عملة';
    const inv = inventory();
    $('#shopItems').innerHTML = shop.items.map((itemId) => {
      const it = ITEMS[itemId];
      const owned = inv[itemId] || 0;
      const isTheme = it.kind === 'outfit' || it.kind === 'hair';
      let actions = '';
      if (isTheme && owned) {
        actions = '<button class="shop-btn" data-apply="' + it.id + '">تطبيق</button>'
          + '<button class="shop-btn sell" data-sell="' + it.id + '">بيع +' + Math.floor(it.price / 2) + '</button>';
      } else {
        actions = '<button class="shop-btn" data-buy="' + it.id + '">شراء</button>';
        if (owned) actions += '<button class="shop-btn sell" data-sell="' + it.id + '">بيع +' + Math.floor(it.price / 2) + '</button>';
      }
      const ownedTag = owned ? '<span class="shop-owned">' + (isTheme ? 'مملوك ✓' : 'تملك: ' + owned) + '</span>' : '';
      return '<div class="shop-item">'
        + '<span class="shop-sw" style="background:' + it.color + '">' + (it.kind === 'gift' ? GIFT_SVG : '') + '</span>'
        + '<div class="shop-id"><b>' + escapeHtml(it.name) + '</b><span>' + escapeHtml(it.desc) + '</span>' + ownedTag + '</div>'
        + '<div class="shop-buy"><span class="shop-price">' + it.price + ' عملة</span>' + actions + '</div>'
        + '</div>';
    }).join('');
  }
  function openShop(id) {
    if (!SHOPS[id]) return;
    currentShop = id;
    shopOpenedAt = Date.now();
    renderShop(id);
    $('#shopScrim').classList.add('show');
    $('#shopSheet').classList.add('show');
  }
  function shopJustOpened() { return Date.now() - shopOpenedAt < 400; }
  function closeShop() {
    currentShop = null;
    $('#shopScrim').classList.remove('show');
    $('#shopSheet').classList.remove('show');
  }

  // ---- buy / sell / apply ----
  function buy(itemId) {
    const it = ITEMS[itemId];
    if (!it) return;
    const inv = inventory();
    if ((it.kind === 'outfit' || it.kind === 'hair') && inv[itemId]) { toast('تملك هذا اللون بالفعل'); return; }
    if (coins() < it.price) { toast('عملاتك لا تكفي'); return; }
    setCoins(coins() - it.price);
    inv[itemId] = (inv[itemId] || 0) + 1;
    saveJSON(INV_KEY, inv);
    renderShop(currentShop);
    toast('تم شراء ' + it.name);
  }
  function sell(itemId) {
    const it = ITEMS[itemId];
    if (!it) return;
    const inv = inventory();
    if (!inv[itemId]) return;
    const refund = Math.floor(it.price / 2);
    inv[itemId]--;
    if (!inv[itemId]) delete inv[itemId];
    saveJSON(INV_KEY, inv);
    setCoins(coins() + refund);
    renderShop(currentShop);
    toast('بعت ' + it.name + ' بـ ' + refund + ' عملة');
  }
  function applyTheme(itemId) {
    const it = ITEMS[itemId];
    if (!it || (it.kind !== 'outfit' && it.kind !== 'hair')) return;
    if (!inventory()[itemId]) { toast('اشترِ هذا اللون أولاً'); return; }
    const field = it.kind === 'hair' ? 'haircolor' : 'outfitcolor';
    const patch = {};
    patch[field] = it.color;
    saveAppearance('kaito', Object.assign({}, getAppearance('kaito'), patch));
    villageScreen.applyAppearance();
    roomScreen.applyAppearance();
    renderShop(currentShop);
    toast('تم تطبيق ' + it.name + ' على ' + getProfile('kaito').name); // v1.6: the player's own name, not «كايتو»
  }

  // ---- gifts (given from the NPC profile sheet) ----
  function ownedGifts() {
    const inv = inventory();
    return Object.keys(inv)
      .filter((id) => ITEMS[id] && ITEMS[id].kind === 'gift' && inv[id] > 0)
      .map((id) => ({ item: ITEMS[id], count: inv[id] }));
  }
  function giftLikeCount(key) {
    const all = loadJSON(GIFT_LIKES_KEY, {});
    return all[key] || 0;
  }
  // Consumes one gift; returns the likes earned (2 for a favorite, else 1).
  function giveGift(npcKey, itemId) {
    const it = ITEMS[itemId];
    if (!it || it.kind !== 'gift') return 0;
    const inv = inventory();
    if (!inv[itemId]) return 0;
    inv[itemId]--;
    if (!inv[itemId]) delete inv[itemId];
    saveJSON(INV_KEY, inv);
    const pts = it.fav === npcKey ? 2 : 1;
    const all = loadJSON(GIFT_LIKES_KEY, {});
    all[npcKey] = (all[npcKey] || 0) + pts;
    saveJSON(GIFT_LIKES_KEY, all);
    return pts;
  }

  function wire() {
    $('#shopClose').addEventListener('click', () => { if (!shopJustOpened()) closeShop(); });
    $('#shopScrim').addEventListener('click', () => { if (!shopJustOpened()) closeShop(); });
    $('#shopItems').addEventListener('click', (e) => {
      const buyBtn = e.target.closest('[data-buy]');
      if (buyBtn) { buy(buyBtn.dataset.buy); return; }
      const sellBtn = e.target.closest('[data-sell]');
      if (sellBtn) { sell(sellBtn.dataset.sell); return; }
      const applyBtn = e.target.closest('[data-apply]');
      if (applyBtn) { applyTheme(applyBtn.dataset.apply); return; }
    });
    renderCoins();
  }

  return { wire, openShop, closeShop, coins, inventory, giftLikeCount, giveGift, ownedGifts, dailyBonus, renderCoins, ITEMS, SHOPS };
})();

// ================= SOCIAL: profiles, likes, friends, chat (v1.2) =================
// All local (localStorage) — no backend, no multiplayer yet. Chats are
// scripted replies from the village characters, NOT real players: nothing
// here pretends anyone is online or connected.
const socialUI = (() => {
  let currentKey = null; // profile open in the sheet
  let chatKey = null;    // character open in the chat overlay
  let replyTimer = null;
  let preview = null;    // { renderer, scene, camera, model, raf, spin }
  let sheetOpenedAt = 0; // see the scrim guard in wire(): touch taps fire a
  // synthetic mouse click right after the tap, and it lands on the scrim
  // that JUST appeared under the finger — without a guard it closes the
  // sheet the tap just opened.

  // ---- storage (tolerant: private mode / quota errors just don't persist) ----
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  const likes = () => loadJSON('suli-likes', {});     // { key: true }
  const friends = () => loadJSON('suli-friends', []); // [key]
  const chats = () => loadJSON('suli-chats', {});     // { key: [{from, text}] }
  const likeCount = (key) => PROFILES[key].baseLikes + (likes()[key] ? 1 : 0) + shopUI.giftLikeCount(key); // v1.5: + gift likes
  const isFriend = (key) => friends().indexOf(key) !== -1;
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- profile sheet ----
  // v1.3: every consumer reads through getProfile (base + player overrides).
  // NPC profiles have no overrides (read-only), kaito's can be edited.
  function renderProfile(key) {
    const p = getProfile(key);
    $('#profileName').textContent = p.name;
    $('#profileLevel').textContent = 'المستوى ' + p.level;
    $('#profileLikes').textContent = likeCount(key);
    $('#profileLikesIcon').textContent = likes()[key] ? '♥' : '♡';
    $('#profileBio').textContent = p.bio;
    $('#profileTraits').innerHTML = p.traits.map((t) => '<span class="chip warm">' + escapeHtml(t) + '</span>').join('');
    $('#profileInterests').innerHTML = p.interests.map((t) => '<span class="chip">' + escapeHtml(t) + '</span>').join('');
    const likeBtn = $('#profileLike');
    likeBtn.classList.toggle('on', !!likes()[key]);
    likeBtn.querySelector('span').textContent = likes()[key] ? 'أعجبك' : 'إعجاب';
    const frBtn = $('#profileFriend');
    frBtn.classList.toggle('on', isFriend(key));
    frBtn.querySelector('span').textContent = isFriend(key) ? 'صديق ✓' : 'إضافة صديق';
    const gp = $('#giftPicker'); // v1.5: the gift picker resets on every re-render
    if (gp) gp.style.display = 'none';
  }
  // ---- v1.5: gift picker (inside the profile sheet) ----
  // Lists the gifts the player OWNS; tapping one consumes it and raises
  // this NPC's like count (+2 for their favorite gift, else +1).
  function renderGiftPicker() {
    const list = $('#giftList');
    const owned = shopUI.ownedGifts();
    if (!owned.length) {
      list.innerHTML = '<span class="mut" style="font-size:13px;line-height:1.7">لا هدايا في مخزونك — اشترِ من متجر الهدايا أو سوق المزارع</span>';
      return;
    }
    list.innerHTML = owned.map((o) =>
      '<button class="gift-chip" data-gift="' + o.item.id + '">'
      + '<span class="gift-dot" style="background:' + o.item.color + '"></span>'
      + escapeHtml(o.item.name) + ' ×' + o.count
      + (o.item.fav === currentKey ? ' <b>★ مفضلة</b>' : '')
      + '</button>'
    ).join('');
  }


  // Small live 3D preview: same small-renderer pattern as the creator
  // thumbs, full body, slowly spinning while the sheet is open. One
  // renderer is created on first open and reused; the spin loop runs only
  // while the sheet is shown. (The sheet is translated off-screen when
  // closed, not display:none, so its box keeps its size and the renderer
  // can be built before the first open animation.)
  function buildPreview(key) {
    const el = $('#profilePreview');
    if (!preview) {
      const w = el.clientWidth, h = el.clientHeight;
      if (w < 10 || h < 10) return;
      preview = {
        renderer: baseRenderer(el, w, h, true),
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(36, w / h, 0.1, 60),
        model: null, raf: 0, spin: 0,
      };
      preview.scene.add(new THREE.HemisphereLight(0xffffff, 0xf3e7cf, 0.85));
      const dl = new THREE.DirectionalLight(0xfff2dd, 1.15);
      dl.position.set(4, 7, 4); preview.scene.add(dl);
      preview.camera.position.set(0.15, 0.95, 2.4);
      preview.camera.lookAt(0, 0.75, 0);
    }
    if (preview.model) { preview.scene.remove(preview.model); preview.model = null; }
    const av = buildCharacter(key, getAppearance(key)); // v1.3: saved colors
    fitHeight(av, 1.5, 0);
    av.rotation.y = -0.25;
    preview.model = av;
    preview.scene.add(av);
    preview.spin = 0;
    if (!preview.raf) {
      const tick = () => {
        preview.raf = requestAnimationFrame(tick);
        if (preview.model) { preview.spin += 0.008; preview.model.rotation.y = -0.25 + preview.spin; }
        preview.renderer.render(preview.scene, preview.camera);
      };
      tick();
    }
  }

  function openProfile(key) {
    if (!PROFILES[key]) return;
    currentKey = key;
    sheetOpenedAt = Date.now();
    renderProfile(key);
    $('#profileScrim').classList.add('show');
    $('#profileSheet').classList.add('show');
    buildPreview(key);
  }
  // True while the synthetic mouse click from the opening tap may still
  // arrive (~0-300ms after touchend). A real user cannot meaningfully tap
  // the scrim or the X within 400ms of the sheet appearing.
  function sheetJustOpened() { return Date.now() - sheetOpenedAt < 400; }
  function closeSheet() {
    currentKey = null;
    $('#profileScrim').classList.remove('show');
    $('#profileSheet').classList.remove('show');
    if (preview && preview.raf) { cancelAnimationFrame(preview.raf); preview.raf = 0; }
  }

  function toggleLike() {
    if (!currentKey) return;
    const all = likes();
    if (all[currentKey]) delete all[currentKey]; else all[currentKey] = true;
    saveJSON('suli-likes', all);
    renderProfile(currentKey);
  }
  function toggleFriend() {
    if (!currentKey) return;
    let f = friends();
    if (isFriend(currentKey)) {
      f = f.filter((k) => k !== currentKey);
      toast('تمت إزالة ' + getProfile(currentKey).name + ' من الأصدقاء');
    } else {
      f.push(currentKey);
      toast('تمت إضافة ' + getProfile(currentKey).name + ' كصديق');
    }
    saveJSON('suli-friends', f);
    renderProfile(currentKey);
    renderFriends();
  }

  // ---- friends list (account screen) ----
  function renderFriends() {
    const list = $('#friendsList');
    const f = friends();
    $('#accFriendsCount').textContent = f.length;
    if (!f.length) {
      list.innerHTML = '<div class="fempty">لا أصدقاء بعد — المس شخصية في القرية لإضافتها كصديق</div>';
      return;
    }
    list.innerHTML = f.map((key) => {
      const p = getProfile(key);
      if (!p) return '';
      return '<div class="frow" data-friend="' + key + '">'
        + '<span class="frow-av" style="background:' + p.color + '">' + p.name.charAt(0) + '</span>'
        + '<div class="frow-id"><b>' + p.name + '</b><span>المستوى ' + p.level + '</span></div>'
        + '<button class="frow-btn" data-chat="' + key + '">مراسلة</button>'
        + '<button class="frow-btn danger" data-unfriend="' + key + '">إزالة</button>'
        + '</div>';
    }).join('');
  }

  // ---- chat ----
  // Reply choice: a keyword match wins; otherwise rotate through the
  // character's lines in order, with a generic fallback after each full
  // cycle (themCount counts the 'them' messages already in the thread, so
  // the rotation survives reloads).
  function pickReply(key, text) {
    const p = PROFILES[key];
    const t = String(text);
    for (const r of p.replies) {
      if (r.keys && r.keys.some((k) => t.indexOf(k) !== -1)) return r.text;
    }
    const thread = chats()[key] || [];
    const themCount = thread.filter((m) => m.from === 'them').length;
    const cycle = p.replies.length + 1;
    if (themCount % cycle === p.replies.length) {
      const fIdx = Math.floor(themCount / cycle) % p.fallbacks.length;
      return p.fallbacks[fIdx];
    }
    return p.replies[themCount % cycle].text;
  }

  function renderChatList() {
    const list = $('#chatList');
    const thread = (chats()[chatKey] || []);
    list.innerHTML = thread.map((m) =>
      '<div class="msg ' + (m.from === 'me' ? 'me' : 'them') + '">' + escapeHtml(m.text) + '</div>'
    ).join('');
    list.scrollTop = list.scrollHeight;
  }
  function openChat(key) {
    if (!PROFILES[key]) return;
    chatKey = key;
    const p = getProfile(key);
    $('#chatName').textContent = p.name;
    const av = $('#chatAvatar');
    av.textContent = p.name.charAt(0);
    av.style.background = p.color;
    $('#chatInput').value = '';
    renderChatList();
    closeSheet();
    $('#chatOverlay').classList.add('show');
  }
  function closeChat() {
    $('#chatOverlay').classList.remove('show');
    chatKey = null;
    if (replyTimer) { clearTimeout(replyTimer); replyTimer = null; }
  }
  function sendMessage() {
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text || !chatKey) return;
    const key = chatKey;
    const all = chats();
    if (!all[key]) all[key] = [];
    all[key].push({ from: 'me', text });
    saveJSON('suli-chats', all);
    input.value = '';
    renderChatList();
    // typing indicator, then the scripted reply ~1s later
    const list = $('#chatList');
    const typing = document.createElement('div');
    typing.className = 'msg them typing';
    typing.innerHTML = '<i></i><i></i><i></i>';
    list.appendChild(typing);
    list.scrollTop = list.scrollHeight;
    const reply = pickReply(key, text);
    if (replyTimer) clearTimeout(replyTimer);
    replyTimer = setTimeout(() => {
      replyTimer = null;
      const all2 = chats();
      if (!all2[key]) all2[key] = [];
      all2[key].push({ from: 'them', text: reply });
      saveJSON('suli-chats', all2);
      // only re-render if the user is still in THIS chat
      if (chatKey === key) { typing.remove(); renderChatList(); }
    }, 1000);
  }

  // ---- my profile (account screen) + edit form (v1.3) ----
  // The player edits ONLY his own profile (kaito). NPC profiles are
  // read-only and never show an edit button. Level and likes are not
  // editable. Empty trait/interest/bio fields fall back to the defaults.
  function renderMyProfile() {
    const p = getProfile('kaito');
    $('#myProfileName').textContent = p.name;
    $('#myProfileLevel').textContent = 'المستوى ' + p.level;
    $('#myProfileBio').textContent = p.bio;
    $('#myProfileTraits').innerHTML = p.traits.map((t) => '<span class="chip warm">' + escapeHtml(t) + '</span>').join('');
    $('#myProfileInterests').innerHTML = p.interests.map((t) => '<span class="chip">' + escapeHtml(t) + '</span>').join('');
  }
  function updateEditCounters() {
    $('#editNameCount').textContent = $('#editName').value.length + '/20';
    $('#editBioCount').textContent = $('#editBio').value.length + '/200';
  }
  function openEditForm() {
    const p = getProfile('kaito');
    $('#editName').value = p.name;
    $('#editBio').value = p.bio;
    p.traits.forEach((t, i) => { $('#editTrait' + i).value = t; });
    p.interests.forEach((t, i) => { $('#editInterest' + i).value = t; });
    updateEditCounters();
    $('#editScrim').classList.add('show');
    $('#editSheet').classList.add('show');
  }
  function closeEditForm() {
    $('#editScrim').classList.remove('show');
    $('#editSheet').classList.remove('show');
  }
  function saveEditForm() {
    const name = $('#editName').value.trim();
    if (!name) { toast('اكتب اسماً للشخصية'); return; }
    const base = PROFILES.kaito;
    const pick = (prefix, i, fallback) => {
      const v = $('#' + prefix + i).value.trim();
      return v || fallback;
    };
    saveProfileOverride('kaito', {
      name,
      bio: $('#editBio').value.trim() || base.bio,
      traits: [pick('editTrait', 0, base.traits[0]), pick('editTrait', 1, base.traits[1]), pick('editTrait', 2, base.traits[2])],
      interests: [pick('editInterest', 0, base.interests[0]), pick('editInterest', 1, base.interests[1]), pick('editInterest', 2, base.interests[2])],
    });
    // the creator name and the profile name are one identity — keep the
    // creator save, the account stat and the home hero in sync
    try {
      const raw = localStorage.getItem('suli-character');
      const st = raw ? JSON.parse(raw) : {};
      st.name = name;
      localStorage.setItem('suli-character', JSON.stringify(st));
    } catch (e) {}
    $('#accName').textContent = name;
    const heroName = $('#screen-home .name b');
    if (heroName) heroName.textContent = name;
    renderMyProfile();
    closeEditForm();
    toast('تم حفظ بروفيلك');
  }
  function resetEditForm() {
    resetProfileOverride('kaito');
    // the creator name follows back to the default too
    try {
      const raw = localStorage.getItem('suli-character');
      const st = raw ? JSON.parse(raw) : {};
      st.name = PROFILES.kaito.name;
      localStorage.setItem('suli-character', JSON.stringify(st));
    } catch (e) {}
    $('#accName').textContent = PROFILES.kaito.name;
    const heroName = $('#screen-home .name b');
    if (heroName) heroName.textContent = PROFILES.kaito.name;
    renderMyProfile();
    openEditForm(); // re-fill the form with the defaults
    toast('تمت استعادة البروفيل الافتراضي');
  }

  function wire() {
    $('#profileClose').addEventListener('click', () => { if (!sheetJustOpened()) closeSheet(); });
    $('#profileScrim').addEventListener('click', () => { if (!sheetJustOpened()) closeSheet(); });
    $('#profileLike').addEventListener('click', toggleLike);
    $('#profileFriend').addEventListener('click', toggleFriend);
    $('#profileMessage').addEventListener('click', () => { if (currentKey) openChat(currentKey); });
    // v1.5: gift button — toggles the owned-gifts picker inside the sheet
    $('#profileGift').addEventListener('click', () => {
      if (!currentKey) return;
      const picker = $('#giftPicker');
      if (picker.style.display === 'block') { picker.style.display = 'none'; return; }
      renderGiftPicker();
      picker.style.display = 'block';
    });
    $('#giftList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-gift]');
      if (!btn || !currentKey) return;
      const pts = shopUI.giveGift(currentKey, btn.dataset.gift);
      if (pts > 0) {
        toast('أهديت ' + shopUI.ITEMS[btn.dataset.gift].name + ' إلى ' + getProfile(currentKey).name + ' (+' + pts + ' إعجاب)');
        renderProfile(currentKey);
      } else {
        toast('لا تملك هذه الهدية');
      }
    });
    $('#chatBack').addEventListener('click', closeChat);
    $('#chatSend').addEventListener('click', sendMessage);
    $('#chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
    $('#friendsList').addEventListener('click', (e) => {
      const chatBtn = e.target.closest('[data-chat]');
      if (chatBtn) { openChat(chatBtn.dataset.chat); return; }
      const unBtn = e.target.closest('[data-unfriend]');
      if (unBtn) {
        const key = unBtn.dataset.unfriend;
        saveJSON('suli-friends', friends().filter((k) => k !== key));
        toast('تمت إزالة ' + getProfile(key).name + ' من الأصدقاء');
        renderFriends();
        if (currentKey === key) renderProfile(key);
        return;
      }
      const row = e.target.closest('[data-friend]');
      if (row) openProfile(row.dataset.friend);
    });
    // v1.3: my-profile edit form (account screen, kaito only)
    $('#editMyProfileBtn').addEventListener('click', openEditForm);
    $('#editClose').addEventListener('click', closeEditForm);
    $('#editScrim').addEventListener('click', closeEditForm);
    $('#editSave').addEventListener('click', saveEditForm);
    $('#editReset').addEventListener('click', resetEditForm);
    $('#editName').addEventListener('input', updateEditCounters);
    $('#editBio').addEventListener('input', updateEditCounters);
    // v1.4.1: render-quality setting (account screen). Changing it reloads
    // the page so every renderer is recreated with the new quality —
    // antialias is fixed when the WebGL context is created and cannot
    // change live. The 350ms delay lets the tap feedback show first.
    const qSeg = $('#qualitySeg');
    if (qSeg) {
      const cur = storedQuality();
      qSeg.querySelectorAll('div').forEach((d) => d.classList.toggle('on', d.dataset.q === cur));
      qSeg.addEventListener('click', (e) => {
        const d = e.target.closest('[data-q]');
        if (!d || d.dataset.q === storedQuality()) return;
        qSeg.querySelectorAll('div').forEach((x) => x.classList.toggle('on', x === d));
        setStoredQuality(d.dataset.q);
        setTimeout(() => window.location.reload(), 350);
      });
    }
    renderFriends();
    renderMyProfile();
  }

  return { wire, openProfile, closeSheet, closeChat, renderFriends, renderMyProfile };
})();

// ================= MAP PICKER (v1.5) =================
// Lists the maps in the registry (MAPS) — A + B in 1.5.1; C/D appear
// here automatically once registered. Switching saves 'suli-map' and
// reloads (same pattern as the quality setting: the village screen is
// built once per load from the selected map). Choosing the current map
// just closes the sheet.
const mapUI = (() => {
  let openedAt = 0;
  function renderList() {
    const cur = selectedMapId();
    $('#mapList').innerHTML = MAPS.map((m) =>
      '<button class="map-row' + (m.id === cur ? ' on' : '') + '" data-map="' + m.id + '">'
      + '<span class="map-name">' + m.name + '</span>'
      + (m.id === cur ? '<span class="map-tick">✓ الحالية</span>' : '<span class="map-tick mut">اختيار</span>')
      + '</button>'
    ).join('');
  }
  function openSheet() {
    openedAt = Date.now();
    renderList();
    $('#mapScrim').classList.add('show');
    $('#mapSheet').classList.add('show');
  }
  function justOpened() { return Date.now() - openedAt < 400; }
  function closeSheet() {
    $('#mapScrim').classList.remove('show');
    $('#mapSheet').classList.remove('show');
  }
  function wire() {
    $('#mapPickerEntry').addEventListener('click', openSheet);
    $('#mapClose').addEventListener('click', () => { if (!justOpened()) closeSheet(); });
    $('#mapScrim').addEventListener('click', () => { if (!justOpened()) closeSheet(); });
    $('#mapList').addEventListener('click', (e) => {
      const row = e.target.closest('[data-map]');
      if (!row) return;
      const id = row.dataset.map;
      if (id === selectedMapId()) { closeSheet(); return; }
      try { localStorage.setItem(MAP_KEY, id); } catch (err) {}
      setTimeout(() => window.location.reload(), 350);
    });
    // the home entry subtitle + the village title show the current map
    const sub = $('#mapPickerSub');
    if (sub) sub.textContent = ACTIVE_MAP.name;
    const vt = $('#villageTitle');
    if (vt) {
      vt.textContent = ACTIVE_MAP.name;
      // v1.5.1: the village pill also opens the picker (live-test finding:
      // it was text-only in 1.5.0). Canvas input binds to the canvas
      // element, so taps on this overlay pill never reach it — no
      // accidental walk or camera drag.
      vt.style.cursor = 'pointer';
      vt.addEventListener('click', openSheet);
    }
  }
  return { wire, openSheet, closeSheet };
})();

// ================= ACCOUNT GATE (v1.6) =================
// First launch = signup (name, username, password, age, gender,
// appearance). Later visits = login (username + password). The gate is
// the ONLY entry: the top bar and bottom nav are hidden (body.gated)
// until enterWorld(), and show() redirects any other navigation to the
// gate while logged out. The 18+ age check runs on signup submit —
// under 18 no account is created and there is no way into the world.
// Passwords are SHA-256 hashed inside accountStore (never plaintext).
// FOLLOW-UP (not in v1.6): "forgot password" / account recovery.
const accountUI = (() => {
  let gender = 'm';
  let haircolor = '#4a2c2a', skin = '#ffd9b3', outfitcolor = '#f5f5f5';

  function showError(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }
  function showAgeBlock(show) {
    const b = $('#suAgeBlock');
    if (b) b.style.display = show ? 'block' : 'none';
  }

  async function submitSignup() {
    showError($('#suError'), '');
    showAgeBlock(false);
    const f = {
      name: $('#suName').value,
      username: $('#suUser').value,
      password: $('#suPass').value,
      age: $('#suAge').value,
      gender,
    };
    const pre = validateSignup(f);
    if (pre === 'AGE_BLOCK') {
      // the 18+ gate: no account, no entry — the banner stays until the
      // age is corrected (the form is NOT cleared, so a typo is fixable);
      // scroll to the top so the banner itself is seen
      showAgeBlock(true);
      const sc = document.querySelector('#screen-signup .scroll');
      if (sc) sc.scrollTop = 0;
      showError($('#suError'), 'هاد اللعبة للبالغين فقط (18+)');
      return;
    }
    if (pre) { showError($('#suError'), pre); return; }
    const btn = $('#suSubmit');
    btn.disabled = true;
    btn.textContent = 'جارٍ إنشاء الحساب...';
    try {
      const res = await accountStore.create(f);
      if (!res.ok) {
        if (res.error === 'AGE_BLOCK') { showAgeBlock(true); showError($('#suError'), 'هاد اللعبة للبالغين فقط (18+)'); }
        else showError($('#suError'), res.error);
        return;
      }
      // the signup appearance goes into the PLAYER slot ('kaito')
      saveAppearance('kaito', { haircolor, skin, eyecolor: '#4a2c2a', outfitcolor });
      // the account name becomes the character's display name everywhere
      // (profile, creator, home hero) — the v1.3 identity sync
      saveProfileOverride('kaito', { name: res.account.name });
      try {
        const raw = localStorage.getItem('suli-character');
        const st = raw ? JSON.parse(raw) : {};
        st.name = res.account.name;
        st.gender = gender;
        localStorage.setItem('suli-character', JSON.stringify(st));
      } catch (e) {}
      enterWorld();
      toast('أهلاً بك في سولي، ' + res.account.name);
    } finally {
      btn.disabled = false;
      btn.textContent = 'ابدأ اللعب';
    }
  }

  async function submitLogin() {
    showError($('#liError'), '');
    const btn = $('#liSubmit');
    btn.disabled = true;
    btn.textContent = 'جارٍ الدخول...';
    try {
      const res = await accountStore.verify($('#liUser').value, $('#liPass').value);
      if (!res.ok) {
        showError($('#liError'), res.error === 'NO_ACCOUNT'
          ? 'لا يوجد حساب على هذا الجهاز — أنشئ حساباً أولاً'
          : 'اسم المستخدم أو كلمة السر غير صحيحة');
        return;
      }
      enterWorld();
      toast('أهلاً بعودتك، ' + res.account.name);
    } finally {
      btn.disabled = false;
      btn.textContent = 'دخول';
    }
  }

  function wire() {
    // gender seg
    $$('#suGenderSeg div').forEach((d) => d.addEventListener('click', () => {
      $$('#suGenderSeg div').forEach((x) => x.classList.toggle('on', x === d));
      gender = d.dataset.g;
    }));
    // appearance dots (same colors as the creator)
    $$('[data-su-group]').forEach((g) => {
      const name = g.dataset.suGroup;
      g.addEventListener('click', (e) => {
        const dot = e.target.closest('.dot');
        if (!dot || !g.contains(dot)) return;
        g.querySelectorAll('.dot').forEach((o) => o.classList.remove('on'));
        dot.classList.add('on');
        if (name === 'haircolor') haircolor = dot.dataset.v;
        else if (name === 'skin') skin = dot.dataset.v;
        else if (name === 'outfitcolor') outfitcolor = dot.dataset.v;
      });
    });
    $('#suSubmit').addEventListener('click', submitSignup);
    $('#liSubmit').addEventListener('click', submitLogin);
    $('#suToLogin').addEventListener('click', () => show('login'));
    $('#liToSignup').addEventListener('click', () => show('signup'));
    // Enter submits the form
    ['#suName', '#suUser', '#suPass', '#suAge'].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitSignup(); });
    });
    ['#liUser', '#liPass'].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitLogin(); });
    });
    // correcting the age hides the block banner again
    const ageEl = $('#suAge');
    if (ageEl) ageEl.addEventListener('input', () => showAgeBlock(false));
    // logout (account screen): end the session and reload so no 3D screen
    // keeps a stale model — after the reload the gate shows the login
    // screen (the account still exists on this device).
    const lo = $('#logoutBtn');
    if (lo) lo.addEventListener('click', () => {
      accountStore.endSession();
      window.location.reload();
    });
  }

  return { wire, submitSignup, submitLogin };
})();

// v1.6: push the account's identity into every place that shows the
// player (home hero, account card, room title, creator name + player
// card label). Called on enterWorld() and on every account-screen visit
// (so the account card stays authoritative over the v1.3 profile sync).
function applyAccountIdentity() {
  const acc = accountStore.get();
  if (!acc) return;
  const heroName = $('#screen-home .name b');
  if (heroName) heroName.textContent = acc.name;
  const accName = $('#accName');
  if (accName) accName.textContent = acc.name;
  const u = $('#accUsername');
  if (u) u.textContent = '@' + acc.username;
  const ag = $('#accAge');
  if (ag) ag.textContent = acc.age + ' سنة';
  const g = $('#accGender');
  if (g) g.textContent = acc.gender === 'f' ? 'أنثى' : 'ذكر';
  const roomTitle = $('#roomTitle');
  if (roomTitle) roomTitle.textContent = 'منزل ' + acc.name;
  const pickLabel = document.querySelector('.pick[data-char="kaito"] b');
  if (pickLabel) pickLabel.textContent = acc.name;
  creatorScreen.setPlayerName(acc.name, acc.gender);
}

// v1.6: the single entry into the world — called on signup success,
// login success, and at boot when a session already exists. Ungates the
// UI, applies the account identity, grants the daily bonus (moved here
// from boot: it must not fire before login), then shows home (or inits
// it directly when home is already the current screen, i.e. a logged-in
// boot — show('home') would early-return in that case).
function enterWorld() {
  document.body.classList.remove('gated');
  applyAccountIdentity();
  shopUI.dailyBonus();
  if (current !== 'home') { show('home'); return; }
  homeScreen.init().then(() => homeScreen.start()).catch(() => {});
}

// ================= SCREEN MANAGER =================
const screens = {
  home: homeScreen,
  village: villageScreen,
  room: roomScreen,
  creator: creatorScreen,
  cinema: null, // static shell
  account: null, // static shell
  signup: null, // v1.6: static shell (account gate)
  login: null, // v1.6: static shell (account gate)
};
let current = 'home';

window.__suli = {
  version: '1.6.0',
  screen: 'home',
  ready: {},
  playerPos: (name) => {
    const s = screens[name];
    return s && s.playerPos ? s.playerPos() : null;
  },
  npcScreen: (key) => villageScreen.npcScreen(key),
  groundScreen: (x, z) => villageScreen.groundScreen(x, z),
  creatorMaterials: () => creatorScreen.debugMaterials(),
  villagePerf: () => villageScreen.perf(),
  villageInfo: () => villageScreen.info(),
  cameraYaw: () => villageScreen.cameraYaw(), // v1.4.1: follow-camera yaw (rad)
  kaitoSpan: () => villageScreen.kaitoSpan(), // v1.4.1: Kaito's on-screen height (viewport fraction)
  cameraPos: () => villageScreen.cameraPos(), // v1.4.1: village camera position
  quality: () => ({ stored: storedQuality(), resolved: resolveQuality(), renderer: villageScreen.quality() }), // v1.4.1
  shopScreen: (id) => villageScreen.shopScreen(id), // v1.5: project a shop to page pixels
  coins: () => shopUI.coins(), // v1.5: coin balance
  inventory: () => shopUI.inventory(), // v1.5: owned items { itemId: count }
  giftLikes: (key) => shopUI.giftLikeCount(key), // v1.5: likes earned by gifting
  openShop: (id) => shopUI.openShop(id), // v1.5: open a shop sheet directly
  map: () => ({ id: ACTIVE_MAP.id, name: ACTIVE_MAP.name }), // v1.5: selected map
  maps: () => MAPS.map((m) => ({ id: m.id, name: m.name })), // v1.5: registry
  // v1.6: account hooks — account() NEVER exposes the password hash
  account: () => {
    const a = accountStore.get();
    return a ? { name: a.name, username: a.username, age: a.age, gender: a.gender } : null;
  },
  isLoggedIn: () => accountStore.isLoggedIn(), // v1.6: session active?
  playerGender: () => playerGender(), // v1.6: 'm' | 'f'
  logout: () => { accountStore.endSession(); window.location.reload(); }, // v1.6 test hook
};

async function show(name) {
  // v1.6: the gate — until the player is logged in, only the signup and
  // login screens exist; any other navigation is redirected to the gate.
  if (!accountStore.isLoggedIn() && name !== 'signup' && name !== 'login') {
    name = accountStore.exists() ? 'login' : 'signup';
  }
  if (current === name) return;
  // v1.2: leaving a screen closes any open sheet/chat (their scrim/overlay
  // would otherwise cover the new screen)
  socialUI.closeSheet();
  socialUI.closeChat();
  shopUI.closeShop(); // v1.5: same for the shop sheet
  mapUI.closeSheet(); // v1.5: same for the map picker
  const prev = screens[current];
  if (prev) prev.stop();
  current = name;
  window.__suli.screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === 'screen-' + name));
  $$('#bottomNav .it').forEach((b) => b.classList.toggle('on', b.dataset.screen === name));
  $('#topBack').style.display = name === 'creator' ? 'flex' : 'none';
  if (name === 'account') { socialUI.renderFriends(); socialUI.renderMyProfile(); applyAccountIdentity(); }
  const sc = screens[name];
  if (sc) {
    try { await sc.init(); } catch (e) { /* load overlay shows the error + retry */ }
    sc.start();
  }
}

// nav + entry buttons
$$('#bottomNav .it').forEach((b) => b.addEventListener('click', () => show(b.dataset.screen)));
$$('[data-goto]').forEach((el) => el.addEventListener('click', () => show(el.dataset.goto)));
$('#topBack').addEventListener('click', () => show('home'));
$('#accToCreator').addEventListener('click', () => show('creator'));

window.addEventListener('resize', () => {
  const sc = screens[current];
  if (sc) sc.resize();
});

// boot: v1.6 — the account gate comes first. No 3D screen inits until
// the player is logged in (the home hero needs the account's gender,
// and the world must not load before the 18+ gate passes). The daily
// bonus now fires inside enterWorld(), not here.
//   - logged-in session  -> straight into the world (home)
//   - account, no session -> login screen
//   - no account          -> signup screen (first launch)
creatorScreen.wireUI();
socialUI.wire();
shopUI.wire(); // v1.5: shop sheet + live coin balance
mapUI.wire(); // v1.5: map picker (home entry + sheet)
accountUI.wire(); // v1.6: signup / login / logout
if (accountStore.isLoggedIn()) {
  enterWorld();
} else {
  document.body.classList.add('gated');
  if (accountStore.exists()) show('login'); else show('signup');
}
