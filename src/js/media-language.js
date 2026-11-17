// Language matching for subtitles and audio tracks. Normalizes tags such as
// eng to en, prefers the player language, then the browser list, then English,
// and picks a same-basename subtitle (video.srt, video.en.srt, video.eng.vtt).
// Also ranks audio tracks by language, then label, then index.
// Exposes window.mediaLanguage: normalize, preferredLanguages, matchSubtitle, matchTrack.

const global = window;

const languageAliases = {
  eng: 'en', fre: 'fr', fra: 'fr', deu: 'de', ger: 'de', spa: 'es', por: 'pt',
  jpn: 'ja', kor: 'ko', zho: 'zh', chi: 'zh', ara: 'ar', hin: 'hi', ita: 'it',
  nld: 'nl', dut: 'nl', pol: 'pl', fas: 'fa', per: 'fa', heb: 'he', tur: 'tr',
  rus: 'ru', ukr: 'uk', swe: 'sv', nor: 'no', dan: 'da', fin: 'fi', ell: 'el',
  gre: 'el', ces: 'cs', cze: 'cs', ron: 'ro', rum: 'ro', hun: 'hu', tha: 'th',
  vie: 'vi', ind: 'id', msa: 'ms', may: 'ms'
};

const stripQuery = (url) => String(url || '').split('#')[0].split('?')[0];

const stripExtension = (url) => {
  const clean = stripQuery(url);
  const match = /^(.*)(?:\.[^./]+)$/.exec(clean);
  return match ? match[1] : clean;
};

const normalize = (code) => {
  const tag = String(code || '').trim().toLowerCase().replace(/_/g, '-');
  if (!tag) return '';
  const parts = tag.split('-');
  parts[0] = languageAliases[parts[0]] || parts[0];
  return parts.join('-');
};

const preferredLanguages = () => {
  const codes = [];
  const push = (code) => {
    const normalized = normalize(code);
    if (normalized && !codes.includes(normalized)) codes.push(normalized);
  };
  if (global.i18n && global.i18n.locale) push(global.i18n.locale);
  const browserLanguages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  browserLanguages.forEach(push);
  push('en');
  return codes;
};

const languageScore = (fileLang, preferred) => {
  if (!fileLang) return 0;
  const file = normalize(fileLang);
  const filePrimary = file.split('-')[0];
  let best = 0;
  preferred.forEach((lang, index) => {
    const rank = file === lang ? 3 : (filePrimary === lang.split('-')[0] ? 2 : 0);
    if (!rank) return;
    const score = rank * 100 - index;
    if (score > best) best = score;
  });
  return best;
};

const fileIdentity = (url, isSubtitle) => {
  const clean = stripQuery(url);
  if (isSubtitle && !isSubtitle(clean)) return null;
  const withoutExt = clean.replace(/\.[^./]+$/, '');
  const langMatch = /^(.*)\.([a-z]{2,3}(?:[-_][a-z0-9]{2,8})?)$/i.exec(withoutExt);
  if (langMatch && /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})?$/i.test(langMatch[2])) {
    return { base: langMatch[1], lang: langMatch[2] };
  }
  return { base: withoutExt, lang: '' };
};

const matchSubtitle = (mediaUrl, files, options = {}) => {
  if (!mediaUrl || !Array.isArray(files)) return null;
  if (options.isAudio && options.isAudio(mediaUrl)) return null;
  const mediaBase = stripExtension(mediaUrl);
  if (!mediaBase) return null;
  const preferred = options.preferred || preferredLanguages();
  const matches = [];
  files.forEach((file) => {
    if (!file || !file.url) return;
    const identity = fileIdentity(file.url, options.isSubtitle);
    if (!identity || identity.base !== mediaBase) return;
    const clean = stripQuery(file.url).toLowerCase();
    matches.push({
      url: file.url,
      language: languageScore(identity.lang, preferred),
      untagged: identity.lang ? 0 : 1,
      vtt: clean.endsWith('.vtt') ? 1 : 0
    });
  });
  matches.sort((a, b) => (b.language - a.language) || (b.untagged - a.untagged) || (b.vtt - a.vtt));
  return matches.length ? matches[0].url : null;
};

const matchTrack = (tracks, preference) => {
  if (!preference || !Array.isArray(tracks)) return -1;
  let bestIndex = -1;
  let bestScore = 0;
  tracks.forEach((track, index) => {
    const language = normalize(track.language || '');
    const preferred = preference.language || '';
    let score = 0;
    if (preferred && language) {
      if (language === preferred) score = 3;
      else if (language.split('-')[0] === preferred.split('-')[0]) score = 2;
    }
    const label = String(track.label || '').trim();
    if (!score && preference.label && label === preference.label) score = 1;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  if (bestIndex >= 0) return bestIndex;
  if (!preference.language && !preference.label && Number.isInteger(preference.index) && tracks[preference.index]) return preference.index;
  return -1;
};

global.mediaLanguage = { normalize, preferredLanguages, matchSubtitle, matchTrack };
