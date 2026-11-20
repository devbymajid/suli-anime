// Suli Anime v1 — SPA controller.
// One render loop runs at a time: switching screens stops the previous
// screen's loop and starts the new one. 3D screens init lazily on first
// visit (each loads the kaito VRM once; the browser cache makes later
// loads fast). No network use beyond the local files.
import * as THREE from 'three';
import { loadVRM, poseVRM, fitVRM, baseRenderer, shadowDisc, nameSprite, buildCreatorEnv, buildVillageEnv, buildHomeEnv } from './env.js';
import { Player, FollowCamera, FixedCamera, createInput } from './player.js';
import { buildCharacter, fitHeight } from './characters-v4.js';

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
  async function init() {
    if (ready) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const vp = $(opts.vp);
      const w = vp.clientWidth, h = vp.clientHeight;
      renderer = baseRenderer(vp, w, h, false);
      scene = new THREE.Scene();
      opts.env(scene);
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
      input = createInput($(opts.joy), $(opts.knob), renderer.domElement, camera, (pt) => player.setTarget(pt.x, pt.z));
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
  version: '1.1.0',
  screen: 'home',
  ready: {},
  playerPos: (name) => {
    const s = screens[name];
    return s && s.playerPos ? s.playerPos() : null;
  },
};

async function show(name) {
  if (current === name) return;
  const prev = screens[current];
  if (prev) prev.stop();
  current = name;
  window.__suli.screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === 'screen-' + name));
  $$('#bottomNav .it').forEach((b) => b.classList.toggle('on', b.dataset.screen === name));
  $('#topBack').style.display = name === 'creator' ? 'flex' : 'none';
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
homeScreen.init().then(() => homeScreen.start()).catch(() => {});
