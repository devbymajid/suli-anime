// Suli Anime v1.3 — character profiles for the village social feature.
// Original characters only: no real anime titles, no real anime characters.
// Levels MUST match the live game (sara 12, yusuf 8, layan 15, kaito 5).
// `replies` are scripted chat lines in the character's voice; each line may
// carry `keys` (Arabic keywords that trigger it). `fallbacks` are generic
// replies used between full cycles through `replies`. Everything is local:
// there is no backend and no multiplayer yet, so chats are scripted.
// v1.3: the PLAYER edits only his own profile (kaito) — NPC profiles are
// read-only. Edits live in localStorage 'suli-profile-overrides' and
// getProfile(key) merges them over the base data, so every consumer (sheet,
// friends list, chat header, account profile) reads the edited values
// through this one path. Level, likes and replies are never editable.

const PROFILES = {
  sara: {
    key: 'sara', name: 'سارة', level: 12, color: '#D96C8A', baseLikes: 27,
    traits: ['مرحة', 'اجتماعية', 'تحب الطبخ'],
    bio: 'تحب الطبخ وتجمع الوصفات من كل قرية تزورها، ودائماً عندها حلوى لذيذة لمن يزورها.',
    interests: ['الطبخ', 'الحلويات', 'البستنة'],
    replies: [
      { keys: ['سلام', 'هلا', 'مرحبا', 'أهلا', 'صباح', 'مساء'], text: 'أهلاً أهلاً! نورت القرية، تعال ذق كعكتي الجديدة قبل أن تبرد.' },
      { keys: ['طبخ', 'أكل', 'وصفة', 'حلوى', 'كعك', 'طعام'], text: 'الطبخ عندي هو السعادة! اليوم جرّبت وصفة كعكة بالفراولة، طلعت أحلى من المتوقع.' },
      { keys: ['حديقة', 'ورد', 'زهر', 'بستنة', 'نبات'], text: 'حديقتي صغيرة لكن فيها أجمل الورود في القرية. أزرع شيئاً جديداً كل أسبوع.' },
      { keys: ['قرية', 'ساكورا', 'شجرة'], text: 'قرية ساكورا أجمل مكان في الدنيا، خصوصاً عندما تتساقط بتلات الورد في الربيع.' },
      { keys: ['لعب', 'سباق', 'كرة'], text: 'أنا لست سريعة في السباق، لكني الأولى دائماً في سباق من يطبخ ألذ طبق!' },
      { text: 'اليوم يوم جميل للمشي في القرية! هل رأيت الفوانيس الجديدة قرب الساحة؟' },
    ],
    fallbacks: [
      'هههه، كلامك يفرحني دائماً.',
      'صحيح! وأنت، ما رأيك؟',
      'أخبرني المزيد، أنا أسمعك.',
      'هذا لطيف جداً منك.',
    ],
  },
  yusuf: {
    key: 'yusuf', name: 'يوسف', level: 8, color: '#5E9A6A', baseLikes: 19,
    traits: ['نشيط', 'تنافسي', 'يحب التحدي'],
    bio: 'لاعب كرة قدم في فريق القرية، لا يقبل الهزيمة بسهولة، ويتدرب كل صباح عند شجرة الساكورا.',
    interests: ['كرة القدم', 'الجري', 'ألعاب القوى'],
    replies: [
      { keys: ['سلام', 'هلا', 'مرحبا', 'أهلا', 'صباح', 'مساء'], text: 'هلا! جاهز لتحدٍّ اليوم؟ أنا جاهز دائماً!' },
      { keys: ['كرة', 'قدم', 'مباراة', 'فريق', 'هدف'], text: 'كرة القدم هي حياتي! سجلت هدفين في مباراة الأمس، والثالث كان قريباً جداً.' },
      { keys: ['جري', 'سباق', 'ركض', 'سرعة'], text: 'أجري كل صباح حول القرية قبل أن يستيقظ أحد. من يجري معي غداً؟' },
      { keys: ['تدريب', 'رياضة', 'قوة'], text: 'التدريب سر كل شيء. مئة تمرين اليوم، ومئتان غداً!' },
      { keys: ['تحدي', 'فوز', 'هزيمة'], text: 'أتحداك في سباق من الساحة إلى البيت الكبير. الفائز يختار عشاء الفريق!' },
      { text: 'طاقتي اليوم عالية! هل نلعب شيئاً في الساحة؟' },
    ],
    fallbacks: [
      'هيا بنا! لا وقت للانتظار.',
      'هذا كلام الأبطال!',
      'اتفقنا. والآن إلى الملعب!',
      'ههه، أنت تتحداني؟ قبلت التحدي!',
    ],
  },
  layan: {
    key: 'layan', name: 'ليان', level: 15, color: '#8B7BB8', baseLikes: 34,
    traits: ['هادئة', 'فنية', 'تحب الرسم'],
    bio: 'ترسم مناظر القرية عند الغروب، وتجمع الألوان من الطبيعة، وتفضل الأماكن الهادئة قرب النهر.',
    interests: ['الرسم', 'الموسيقى الهادئة', 'القراءة'],
    replies: [
      { keys: ['سلام', 'هلا', 'مرحبا', 'أهلا', 'صباح', 'مساء'], text: 'أهلاً... الغروب اليوم جميل، أليس كذلك؟' },
      { keys: ['رسم', 'لوحة', 'ألوان', 'فن'], text: 'أرسم لوحة جديدة للساحة عند الغروب. الألوان الوردية والذهبية معاً ساحرة.' },
      { keys: ['موسيقى', 'أغنية', 'لحن'], text: 'الموسيقى الهادئة تساعدني على الرسم. أستمع إليها وأنا أعمل كل مساء.' },
      { keys: ['كتاب', 'قراءة', 'قصة'], text: 'أقرأ الآن قصة عن قرية بعيدة تشبه قريتنا. القصص تفتح أبواباً كثيرة.' },
      { keys: ['هدوء', 'نهر', 'طبيعة'], text: 'المكان الهادئ قرب النهر هو مكاني المفضل. هناك أسمع أفكاري بوضوح.' },
      { text: 'أحياناً أجلس ساعات أتأمل الغيوم فوق القرية... كل غيمة تحكي قصة.' },
    ],
    fallbacks: [
      'هممم... جميل.',
      'أفهم ما تقصد تماماً.',
      'أخبرني أكثر، بصوت هادئ.',
      'هذا يستحق لوحة.',
    ],
  },
  kaito: {
    key: 'kaito', name: 'كايتو', level: 5, color: '#2F7FC4', baseLikes: 15,
    traits: ['فضولي', 'شجاع', 'يحب الاستكشاف'],
    bio: 'وصل حديثاً إلى القرية، يحب استكشاف كل زاوية والتعرف على سكانها.',
    interests: ['الاستكشاف', 'التصوير', 'المغامرات'],
    replies: [
      { keys: ['سلام', 'هلا', 'مرحبا', 'أهلا', 'صباح', 'مساء'], text: 'أهلاً! أنا كايتو، جديد في القرية وأريد معرفة كل شيء عنها.' },
      { keys: ['استكشاف', 'مغامرة', 'رحلة'], text: 'كل زاوية في القرية تخفي شيئاً جديداً. هل اكتشفت مكاناً سرياً بعد؟' },
      { keys: ['تصوير', 'صورة'], text: 'أحب تصوير القرية من كل الجهات. أجمل صورة عندي هي للساحة وقت الغروب.' },
      { keys: ['قرية', 'ساكورا', 'شجرة'], text: 'قرية ساكورا مكان رائع. الناس هنا طيبون والشوارع جميلة.' },
      { text: 'اليوم سأزور طرف القرية الذي لم أره بعد. من يأتي معي؟' },
    ],
    fallbacks: [
      'رائع! حدثني أكثر.',
      'هذا مشوق فعلاً.',
      'لم أكن أعرف هذا!',
      'هيا نكتشف ذلك معاً.',
    ],
  },
};

// ---- v1.3: player profile overrides (kaito only, via the edit form) ----
const OVERRIDE_KEY = 'suli-profile-overrides';

function loadOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function saveOverrides(all) {
  try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(all)); } catch (e) {}
}
// Merged profile: base data + the player's overrides (name / bio / traits /
// interests only). Invalid override values fall back to the base data.
function getProfile(key) {
  const base = PROFILES[key];
  if (!base) return null;
  const o = loadOverrides()[key] || {};
  const chips = (v) => (Array.isArray(v) && v.length === 3 && v.every((s) => typeof s === 'string' && s)) ? v : null;
  return Object.assign({}, base, {
    name: (typeof o.name === 'string' && o.name.trim()) ? o.name.trim() : base.name,
    bio: (typeof o.bio === 'string' && o.bio.trim()) ? o.bio.trim() : base.bio,
    traits: chips(o.traits) || base.traits,
    interests: chips(o.interests) || base.interests,
  });
}
function saveProfileOverride(key, patch) {
  const all = loadOverrides();
  all[key] = Object.assign({}, all[key] || {}, patch);
  saveOverrides(all);
}
function resetProfileOverride(key) {
  const all = loadOverrides();
  delete all[key];
  saveOverrides(all);
}

export { PROFILES, getProfile, saveProfileOverride, resetProfileOverride };
