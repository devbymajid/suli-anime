// Suli Anime v1.2 — SPA controller.
// One render loop runs at a time: switching screens stops the previous
// screen's loop and starts the new one. 3D screens init lazily on first
// visit (each loads the kaito VRM once; the browser cache makes later
// loads fast). No network use beyond the local files.
// v1.2 adds the village social feature: tap an NPC to open their profile
// (like / add friend / scripted chat), all stored in localStorage.
import * as THREE from 'three';
import { loadVRM, poseVRM, fitVRM, baseRenderer, shadowDisc, nameSprite, buildCreatorEnv, buildVillageEnv, buildHomeEnv } from './env.js';
import { Player, FollowCamera, FixedCamera, createInput } from './player.js';
import { buildCharacter, fitHeight } from './characters-v4.js';
import { PROFILES } from './profiles.js';

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
      const envHandles = opts.env(scene) || {}; // village returns { npcs }
      if (envHandles.npcs) npcs = envHandles.npcs;
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
      // name label above the player (added AFTER fitVRM so it is not in the box)
      const label = nameSprite('كايتو', 'المستوى 5', 0.45);
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
        camFollow.update(dt, player);
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
  camDist: 4.6, camHeight: 2.7,
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
    outfit: 'hoodie-white', skin: '#ffd9b3',
  };

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

  async function setPreviewChar(key) {
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
    } else {
      currentModel = buildCharacter(key);
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

  function buildThumb(el, key) {
    const w = el.clientWidth, h = el.clientHeight;
    if (w < 10 || h < 10) return;
    const r = baseRenderer(el, w, h, true);
    const sc = new THREE.Scene();
    const av = buildCharacter(key);
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
      setPreviewChar(key).catch(() => toast('تعذّر تحميل الشخصية'));
      // choosing a character sets the name field and the gender to its default
      state.name = CHAR_NAMES[key];
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
  function renderProfile(key) {
    const p = PROFILES[key];
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
    const av = buildCharacter(key);
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
      toast('تمت إزالة ' + PROFILES[currentKey].name + ' من الأصدقاء');
    } else {
      f.push(currentKey);
      toast('تمت إضافة ' + PROFILES[currentKey].name + ' كصديق');
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
      const p = PROFILES[key];
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
    const p = PROFILES[key];
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
        toast('تمت إزالة ' + PROFILES[key].name + ' من الأصدقاء');
        renderFriends();
        if (currentKey === key) renderProfile(key);
        return;
      }
      const row = e.target.closest('[data-friend]');
      if (row) openProfile(row.dataset.friend);
    });
    renderFriends();
  }

  return { wire, openProfile, closeSheet, closeChat, renderFriends };
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
  version: '1.2.0',
  screen: 'home',
  ready: {},
  playerPos: (name) => {
    const s = screens[name];
    return s && s.playerPos ? s.playerPos() : null;
  },
  npcScreen: (key) => villageScreen.npcScreen(key),
  groundScreen: (x, z) => villageScreen.groundScreen(x, z),
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
  if (name === 'account') socialUI.renderFriends();
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
