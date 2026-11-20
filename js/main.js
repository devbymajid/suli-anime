// Suli Anime v1.4 — SPA controller.
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
import * as THREE from 'three';
import { loadVRM, poseVRM, fitVRM, baseRenderer, shadowDisc, nameSprite, buildCreatorEnv, buildVillageEnv, buildHomeEnv, storedQuality, setStoredQuality, resolveQuality } from './env.js';
import { Player, FollowCamera, FixedCamera, createInput } from './player.js';
import { buildCharacter, fitHeight } from './characters-v4.js';
import { PROFILES, getProfile, saveProfileOverride, resetProfileOverride } from './profiles.js';
import { getAppearance, getStoredAppearance, saveAppearance, diffAppearance, tintVRM } from './appearance.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

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
        model = await loadVRM('dero.vrm');
      } catch (e) {
        loadError($('#homeLoad'), () => { initPromise = null; init().then(() => homeScreen.start()).catch(() => {}); });
        throw e;
      }
      poseVRM(model);
      fitVRM(model, 1.6, 0.22);
      tintVRM(model, getStoredAppearance('kaito')); // v1.3: saved colors
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

// ================= WALKABLE SCREEN factory (village + room) =================
function makeWalkScreen(opts) {
  let ready = false, initPromise = null, hintHidden = false;
  let renderer, scene, camera, player, camFollow, input, disc, loop = makeLoop();
  let npcs = null; // v1.2: village NPC groups for tap-to-profile (room: none)
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
  async function init() {
    if (ready) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const vp = $(opts.vp);
      const w = vp.clientWidth, h = vp.clientHeight;
      renderer = baseRenderer(vp, w, h, false);
      scene = new THREE.Scene();
      const envHandles = opts.env(scene) || {}; // village returns { npcs, colliders, stats }
      if (envHandles.npcs) npcs = envHandles.npcs;
      if (envHandles.colliders) colliders = envHandles.colliders;
      if (envHandles.stats) envStats = envHandles.stats;
      camera = new THREE.PerspectiveCamera(opts.fov || 46, w / h, 0.1, 80);
      let av;
      try {
        av = await loadVRM('dero.vrm');
      } catch (e) {
        loadError($(opts.load), () => { initPromise = null; init().then(() => api.start()).catch(() => {}); });
        throw e;
      }
      poseVRM(av);
      fitVRM(av, 1.45, 0);
      tintVRM(av, getStoredAppearance('kaito')); // v1.3: saved colors
      // v1.4.1: the player casts a real shadow on high quality (opaque
      // meshes only — a transparent mesh would cast a solid blob).
      av.traverse((o) => { if (o.isMesh && !(o.material && o.material.transparent)) o.castShadow = true; });
      // name label above the player (added AFTER fitVRM so it is not in the box)
      // v1.3: uses the edited profile name (set at screen init; a rename
      // shows here after reload).
      const label = nameSprite(getProfile('kaito').name, 'المستوى 5', 0.45);
      label.position.set(0, 2.05, 0);
      av.add(label);
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
        npcs ? (nx, ny) => pickNPC(nx, ny) : undefined); // v1.2: NPC taps first
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
  };
  return api;
}

const villageScreen = makeWalkScreen({
  name: 'village', vp: '#villageVp', load: '#villageLoad', joy: '#joyVillage', knob: '#knobVillage',
  env: buildVillageEnv,
  bounds: { minX: -6.5, maxX: 6.5, minZ: -6, maxZ: 6.5 },
  start: { x: 0, z: 2.5, ry: 0 }, // facing -Z, down the path toward the houses
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
      if (!kaitoModel) {
        kaitoModel = await loadVRM('dero.vrm');
        poseVRM(kaitoModel);
        fitVRM(kaitoModel, 1.55, 0.22);
      }
      currentModel = kaitoModel;
      tintVRM(currentModel, appOverride ? diffAppearance(key, appOverride) : getStoredAppearance(key));
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
  // v1.3: load a character's SAVED colors into the creator state + dots.
  function syncCreatorColors(key) {
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
    const av = await loadVRM('dero.vrm');
    poseVRM(av);
    fitVRM(av, 1.5, 0);
    tintVRM(av, getStoredAppearance('kaito')); // v1.3: saved colors
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
    // v1.3 test hook: the colors the current preview model shows.
    // Kaito (VRM): the tinted material colors. Code-built characters:
    // the colors the rebuild used (see appliedAppearance).
    debugMaterials() {
      if (!currentModel) return null;
      if (currentChar !== 'kaito') {
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
  const likeCount = (key) => PROFILES[key].baseLikes + (likes()[key] ? 1 : 0);
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

// ================= SCREEN MANAGER =================
const screens = {
  home: homeScreen,
  village: villageScreen,
  room: roomScreen,
  creator: creatorScreen,
  cinema: null, // static shell
  account: null, // static shell
};
let current = 'home';

window.__suli = {
  version: '1.4.1',
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
};

async function show(name) {
  if (current === name) return;
  // v1.2: leaving a screen closes any open sheet/chat (their scrim/overlay
  // would otherwise cover the new screen)
  socialUI.closeSheet();
  socialUI.closeChat();
  const prev = screens[current];
  if (prev) prev.stop();
  current = name;
  window.__suli.screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === 'screen-' + name));
  $$('#bottomNav .it').forEach((b) => b.classList.toggle('on', b.dataset.screen === name));
  $('#topBack').style.display = name === 'creator' ? 'flex' : 'none';
  if (name === 'account') { socialUI.renderFriends(); socialUI.renderMyProfile(); }
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

// boot: home screen first
creatorScreen.wireUI();
socialUI.wire();
homeScreen.init().then(() => homeScreen.start()).catch(() => {});
