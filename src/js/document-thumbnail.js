const global = window;
// document-thumbnail.js v1.0.0
// Thumbnail creation for document listings.
// License: MIT

const defaults = {
  previewBytes: 4096,
  size: 320,
  mime: { type: 'image/webp', quality: 0.7 },
  className: 'document-preview',
  fetch: (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
};

const kinds = { pdf: 'pdf', txt: 'text', html: 'html', htm: 'html', xhtml: 'html' };

const documentKind = (url) => {
  const cleanUrl = String(url || '').split('#')[0].split('?')[0];
  return kinds[(/\.([^./]+)$/.exec(cleanUrl)?.[1] || '').toLowerCase()] || '';
};

const normalizeOptions = (options = {}) => {
  const out = {
    ...defaults,
    ...options,
    mime: { ...defaults.mime, ...(options.mime || {}) }
  };
  if (!(out.size > 0)) out.size = defaults.size;
  if (!(out.previewBytes > 0)) out.previewBytes = defaults.previewBytes;
  if (!out.mime.type) out.mime.type = defaults.mime.type;
  return out;
};

// Servers may ignore Range, so stop reading once the preview is full.
const readTextPreview = async (url, options) => {
  const previewBytes = options.previewBytes;
  const response = await options.fetch(url, { headers: { Range: `bytes=0-${previewBytes - 1}` } });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const reader = response.body.getReader();
  const bytes = new Uint8Array(previewBytes);
  let size = 0;
  while (size < previewBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value.subarray(0, previewBytes - size);
    bytes.set(chunk, size);
    size += chunk.length;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder().decode(bytes.subarray(0, size));
};

const renderTextThumbnail = (text, options) => {
  const width = options.size * 2;
  const height = Math.round(width * 9 / 16);
  const fontSize = Math.round(width / 40);
  const lineHeight = Math.round(fontSize * 1.4);
  const padding = fontSize;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#26262b';
  ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = 'top';

  const maxChars = Math.max(1, Math.floor((width - padding * 2) / ctx.measureText('M').width));
  const maxLines = Math.floor((height - padding) / lineHeight);
  const lines = [];
  for (const line of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    for (let i = 0; i === 0 || i < line.length; i += maxChars) lines.push(line.slice(i, i + maxChars));
    if (lines.length >= maxLines) break;
  }
  lines.slice(0, maxLines).forEach((line, i) => ctx.fillText(line, padding, padding + i * lineHeight));

  // Text needs a higher quality than video frames to stay legible.
  const mime = options.mime;
  return new Promise((resolve) => canvas.toBlob(resolve, mime.type, Math.max(mime.quality || 0, defaults.mime.quality)));
};

const createHtmlPreview = (url, options) => {
  const frame = document.createElement('iframe');
  frame.className = options.className;
  frame.setAttribute('sandbox', '');
  frame.setAttribute('loading', 'lazy');
  frame.setAttribute('scrolling', 'no');
  frame.setAttribute('tabindex', '-1');
  frame.setAttribute('aria-hidden', 'true');
  frame.src = url;
  return frame;
};

const createTextThumbnail = async (url, options) => {
  if (!options.fetch) throw new Error('fetch() is not available in this environment.');
  const blob = await renderTextThumbnail(await readTextPreview(url, options), options);
  return { kind: 'text', blob };
};

// HTML previews return immediately. Text previews return a promise of `{ kind, blob }`.
// PDF has no generated preview; a same-name image is applied by the library as a prerendered thumbnail.
const documentThumbnail = (url, options = {}) => {
  const opts = normalizeOptions(options);
  const kind = options.kind || documentKind(url);
  if (kind === 'html') return { kind, element: createHtmlPreview(url, opts) };
  if (kind === 'text') return createTextThumbnail(url, opts);
  return null;
};

documentThumbnail.kind = documentKind;
documentThumbnail.extensions = Object.keys(kinds);
documentThumbnail.defaults = defaults;

global.documentThumbnail = documentThumbnail;
