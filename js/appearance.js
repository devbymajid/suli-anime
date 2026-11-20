// Suli Anime v1.3 — character appearance: storage + application.
// Colors (hair / skin / eyes / outfit) are LIVE: they change the 3D model.
//   - Code-built characters (sara / yusuf / layan) are REBUILT from their
//     spec with the chosen colors (see buildCharacter(key, app)).
//   - Kaito's VRM is tinted IN PLACE by material name (VRoid names:
//     *_HAIR, *_SKIN, *_Tops_*). The VRM textures already carry color
//     (skin tone, brown iris), so a tint MULTIPLIES the texture: tinting
//     is applied ONLY to fields the player actually changed, so an
//     untouched character keeps its exact original look.
//     EYES ARE NOT TINTED ON THE VRM (verified 2026-11-20): the iris
//     texture is baked brown, so a blue tint multiplies to near-black —
//     the eyes look muddy and the picked color never shows. Eye color for
//     kaito is saved-only; the creator note says so. (The code-built
//     characters have no iris texture, so their eyes recolor cleanly.)
// Styles (hairstyle, face, eye shape, outfit style) stay saved-only —
// they are stored in suli-character, not here.
// Storage: localStorage key 'suli-appearance' =
//   { [charKey]: { haircolor?, skin?, eyecolor?, outfitcolor? } }
// Only fields that DIFFER from the defaults are stored.

const KEY = 'suli-appearance';

// Defaults match each character's current look, so nothing changes for
// existing players until they edit. Kaito's defaults are the creator's
// default picks; the NPC defaults are their spec colors.
const DEFAULTS = {
  kaito: { haircolor: '#4a2c2a', skin: '#ffd9b3', eyecolor: '#4a2c2a', outfitcolor: '#f5f5f5' },
  yusuf: { haircolor: '#c0392b', skin: '#ffd9b3', eyecolor: '#2f9fd8', outfitcolor: '#1e1e26' },
  sara: { haircolor: '#6b4226', skin: '#ffd9b3', eyecolor: '#8b5cf6', outfitcolor: '#f5f5f5' },
  layan: { haircolor: '#4a3542', skin: '#ffd9b3', eyecolor: '#7c4a2d', outfitcolor: '#2b2f3a' },
};
const FIELDS = ['haircolor', 'skin', 'eyecolor', 'outfitcolor'];

function loadAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function isHex(s) { return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s); }

// Merged appearance (defaults + stored) — for the creator controls and for
// rebuilding code-built characters.
function getAppearance(key) {
  const d = DEFAULTS[key] || DEFAULTS.kaito;
  const o = (loadAll()[key]) || {};
  const out = {};
  FIELDS.forEach((f) => { out[f] = isHex(o[f]) ? o[f] : d[f]; });
  return out;
}
// Raw stored overrides only ({} when nothing saved) — for VRM tinting.
function getStoredAppearance(key) {
  const o = (loadAll()[key]) || {};
  const out = {};
  FIELDS.forEach((f) => { if (isHex(o[f])) out[f] = o[f]; });
  return out;
}
// Fields in `colors` that differ from the character's defaults.
function diffAppearance(key, colors) {
  const d = DEFAULTS[key] || DEFAULTS.kaito;
  const out = {};
  FIELDS.forEach((f) => {
    if (isHex(colors[f]) && colors[f].toLowerCase() !== d[f].toLowerCase()) out[f] = colors[f];
  });
  return out;
}
// Persist: only differing fields are stored (an explicit pick of the
// default value clears that field, restoring the original look).
function saveAppearance(key, colors) {
  const all = loadAll();
  all[key] = diffAppearance(key, colors || {});
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
  return all[key];
}

// ---- VRM tinting (Kaito) ----
// Idempotent: every call first restores each matched material to its
// original color (stashed on first sight), then applies the overrides.
// So calling it with {} restores the untouched model, and repeated calls
// never accumulate.
function tintVRM(model, overrides) {
  if (!model) return;
  const o = overrides || {};
  model.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach((m) => {
      if (!m || !m.name || !m.color) return;
      let field = null;
      if (m.name.indexOf('_HAIR') !== -1) field = 'haircolor';
      else if (m.name.indexOf('_SKIN') !== -1) field = 'skin';
      else if (m.name.indexOf('_Tops_') !== -1) field = 'outfitcolor';
      // NOTE: EyeIris is deliberately NOT tinted (baked brown iris texture
      // multiplies to near-black — verified visually, see header).
      if (!field) return;
      if (m.userData._origColor === undefined) m.userData._origColor = m.color.getHex();
      m.color.setHex(m.userData._origColor);
      if (o[field]) m.color.set(o[field]);
    });
  });
}

export { getAppearance, getStoredAppearance, diffAppearance, saveAppearance, tintVRM, DEFAULTS };
