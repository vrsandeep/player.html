// ISO BMFF reader for audio tracks. Lists handler name and language from moov,
// fetching only the bytes that contain it, and rewrites a file so one audio
// track remains. Playback and the picker live in audio-tracks.js.
// Exposes window.mp4Audio: listTracks, readTracks, isolateTrack.

const global = window;

const fourcc = (view, offset) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

const readBoxes = (view, start, end) => {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = fourcc(view, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return { boxes, partial: { start: offset } };
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (!Number.isFinite(size) || size < header) break;
    if (offset + size > end) return { boxes, partial: { type, start: offset, size, header } };
    boxes.push({ type, start: offset, size, header, end: offset + size });
    offset += size;
  }
  return { boxes, partial: null };
};

const findBox = (view, box, type) => {
  for (const child of readBoxes(view, box.start + box.header, box.end).boxes) {
    if (child.type === type) return child;
    const nested = findBox(view, child, type);
    if (nested) return nested;
  }
  return null;
};

const cstring = (view, start, end) => {
  let text = '';
  for (let i = start; i < end; i++) {
    const code = view.getUint8(i);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  try { return decodeURIComponent(escape(text)); } catch (e) { return text; }
};

const audioTracks = (view, moov) => {
  const tracks = [];
  readBoxes(view, moov.start + moov.header, moov.end).boxes.forEach((box) => {
    if (box.type !== 'trak') return;
    const hdlr = findBox(view, box, 'hdlr');
    if (!hdlr || fourcc(view, hdlr.start + hdlr.header + 8) !== 'soun') return;
    const mdhd = findBox(view, box, 'mdhd');
    let language = '';
    if (mdhd) {
      const version = view.getUint8(mdhd.start + mdhd.header);
      const packed = view.getUint16(mdhd.start + mdhd.header + (version === 1 ? 32 : 20));
      language = String.fromCharCode(0x60 + ((packed >> 10) & 31), 0x60 + ((packed >> 5) & 31), 0x60 + (packed & 31));
      if (language === 'und') language = '';
    }
    const rawName = cstring(view, hdlr.start + hdlr.header + 24, hdlr.end).trim();
    tracks.push({ label: rawName && rawName !== 'SoundHandler' ? rawName : '', language, box });
  });
  return tracks;
};

const listTracks = (bytes) => {
  if (!bytes || !bytes.length) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = readBoxes(view, 0, bytes.length).boxes.find((box) => box.type === 'moov');
  if (!moov) return [];
  return audioTracks(view, moov).map(({ label, language }) => ({ label, language }));
};

const contentRangeTotal = (response) => {
  const match = /\/(\d+)\s*$/.exec(response.headers.get('content-range') || '');
  return match ? Number(match[1]) : 0;
};

const fetchRange = async (url, start, end) => {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!response.ok) throw new Error(`Unable to read media (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const total = response.status === 200 ? bytes.length : (contentRangeTotal(response) || bytes.length);
  return { bytes, total, whole: response.status === 200 || (start === 0 && bytes.length >= total) };
};

const readTracks = async (url) => {
  const first = await fetchRange(url, 0, 1048575);
  if (first.whole) return listTracks(first.bytes);
  const view = new DataView(first.bytes.buffer, first.bytes.byteOffset, first.bytes.byteLength);
  const scanned = readBoxes(view, 0, first.bytes.length);
  if (scanned.boxes.some((box) => box.type === 'moov')) return listTracks(first.bytes);
  const partial = scanned.partial;
  if (partial && partial.type === 'moov' && partial.size) {
    const exact = await fetchRange(url, partial.start, partial.start + partial.size - 1);
    return listTracks(exact.bytes);
  }
  const moovStart = partial && partial.size ? partial.start + partial.size : Math.max(0, first.total - 1048576);
  if (moovStart >= first.total) return [];
  const rest = await fetchRange(url, moovStart, first.total - 1);
  return listTracks(rest.bytes);
};

const isolateTrack = (bytes, index) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = readBoxes(view, 0, bytes.length).boxes;
  const moov = top.find((box) => box.type === 'moov');
  const mdat = top.find((box) => box.type === 'mdat');
  if (!moov || !mdat) return null;
  const children = readBoxes(view, moov.start + moov.header, moov.end).boxes;
  const tracks = audioTracks(view, moov);
  const keep = tracks[index] && tracks[index].box;
  if (!keep || tracks.length < 2) return null;
  const audioBoxes = new Set(tracks.map((track) => track.box));
  const kept = [];
  let removed = 0;
  children.forEach((box) => {
    if (audioBoxes.has(box) && box !== keep) removed += box.size;
    else kept.push(bytes.subarray(box.start, box.end));
  });
  const header = bytes.slice(moov.start, moov.start + moov.header);
  const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (moov.header === 16) headerView.setBigUint64(8, BigInt(moov.size - removed));
  else headerView.setUint32(0, moov.size - removed);
  const parts = [];
  top.forEach((box) => {
    if (box === moov) parts.push(header, ...kept);
    else parts.push(bytes.subarray(box.start, box.end));
  });
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  parts.forEach((part) => {
    out.set(part, cursor);
    cursor += part.length;
  });
  const outView = new DataView(out.buffer);
  const newMdat = readBoxes(outView, 0, out.length).boxes.find((box) => box.type === 'mdat');
  const delta = newMdat ? newMdat.start - mdat.start : 0;
  if (!delta) return out;
  const walk = (start, end) => {
    readBoxes(outView, start, end).boxes.forEach((box) => {
      if (box.type === 'stco' || box.type === 'co64') {
        const count = outView.getUint32(box.start + box.header + 4);
        const wide = box.type === 'co64';
        for (let i = 0; i < count; i++) {
          const pos = box.start + box.header + 8 + i * (wide ? 8 : 4);
          if (wide) outView.setBigUint64(pos, outView.getBigUint64(pos) + BigInt(delta));
          else outView.setUint32(pos, (outView.getUint32(pos) + delta) >>> 0);
        }
      } else {
        walk(box.start + box.header, box.end);
      }
    });
  };
  walk(0, out.length);
  return out;
};

global.mp4Audio = { listTracks, readTracks, isolateTrack };
