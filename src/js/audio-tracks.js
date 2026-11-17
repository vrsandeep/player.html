// Audio track picker. Shows a button only when a video has more than one track,
// remembers the choice per folder, and asks mp4Audio to isolate that track when
// the browser cannot switch audioTracks itself. The player passes a host
// (player, modal, URL getters, and label/modal callbacks) and calls
// refresh, render, reset, and tracks.

const global = window;

const folderKey = (url) => {
  const clean = String(url || '').split('#')[0].split('?')[0];
  const slash = clean.lastIndexOf('/');
  return slash >= 0 ? clean.slice(0, slash + 1) : '';
};

const nativeTracks = (player) => {
  const list = player && player.audioTracks;
  if (!list || !list.length) return [];
  const tracks = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i]) tracks.push(list[i]);
  }
  return tracks;
};

const setEnabled = (tracks, index) => {
  const chosen = tracks[index];
  if (!chosen) return;
  try {
    chosen.enabled = true;
    tracks.forEach((track, i) => {
      if (i !== index) track.enabled = false;
    });
  } catch (e) {}
};

const createAudioTrackSwitcher = (host) => {
  const preferenceByFolder = new Map();
  const boundLists = new WeakSet();
  let discoverToken = 0;
  let rewriteGeneration = 0;
  let discoveredUrl = '';
  let discoveredTracks = [];
  let blobUrl = '';
  let appliedFor = '';
  let applying = false;

  const mediaUrl = () => {
    const url = host.getMediaUrl();
    if (discoveredUrl && blobUrl && url === blobUrl) return discoveredUrl;
    return url;
  };

  const tracks = () => {
    const native = nativeTracks(host.player);
    const discovered = discoveredUrl && discoveredUrl === mediaUrl() ? discoveredTracks : [];
    return discovered.length > native.length ? discovered : native;
  };

  const remember = (track, index) => {
    const folder = folderKey(mediaUrl());
    if (!folder) return;
    preferenceByFolder.set(folder, {
      language: global.mediaLanguage.normalize(track.language || ''),
      label: String(track.label || '').trim(),
      index
    });
  };

  const updateVisibility = () => {
    const multiple = !host.isAudioMode() && tracks().length > 1;
    host.body.classList.toggle('no-audio-tracks', !multiple);
    if (!multiple && host.modal && host.modal.classList.contains('show')) host.closeModal();
  };

  const render = () => {
    if (!host.modal) return;
    const items = tracks().map((track, index) => {
      const selected = track.enabled ? ' is-selected' : '';
      const current = track.enabled ? " aria-current='true'" : '';
      return `<li class='audio-choice modal-item${selected}' tabindex='0' data-audio-index='${index}'${current}>${host.escapeHtml(host.trackLabel(track, index))}</li>`;
    }).join('');
    host.modal.innerHTML = `${host.closeButtonHtml()}${items}`;
    host.modal.querySelectorAll('.audio-choice').forEach((choice) => {
      const activate = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        select(Number(choice.dataset.audioIndex));
        host.closeModal();
      };
      choice.addEventListener('click', activate);
      choice.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        activate(event);
      });
    });
  };

  const restorePosition = (time, paused, rate) => {
    const apply = () => {
      if (Number.isFinite(time) && time > 0) {
        try { host.player.currentTime = time; } catch (e) {}
      }
      if (Number.isFinite(rate) && rate > 0) host.player.playbackRate = rate;
      if (!paused) host.player.play().catch(() => {});
    };
    if (host.player.readyState >= 1) apply();
    else host.player.addEventListener('loadedmetadata', apply, { once: true });
  };

  const useContainerTrack = async (index) => {
    const url = mediaUrl();
    const generation = ++rewriteGeneration;
    const playable = await host.getPlayableUrl(url);
    if (generation !== rewriteGeneration || mediaUrl() !== url) return;
    const time = host.player.currentTime || 0;
    const paused = host.player.paused;
    const rate = host.player.playbackRate;
    if (index === 0) {
      if (blobUrl && host.player.src === blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = '';
        host.player.src = playable;
        restorePosition(time, paused, rate);
      }
      return;
    }
    const response = await fetch(playable);
    if (!response.ok) throw new Error(`Unable to read media (${response.status})`);
    const isolated = global.mp4Audio.isolateTrack(new Uint8Array(await response.arrayBuffer()), index);
    if (!isolated || generation !== rewriteGeneration || mediaUrl() !== url) return;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob([isolated], { type: 'video/mp4' }));
    host.player.src = blobUrl;
    restorePosition(time, paused, rate);
  };

  const select = (index) => {
    const available = tracks();
    const track = available[index];
    if (!track) return;
    remember(track, index);
    const native = nativeTracks(host.player);
    if (native.length > 1) setEnabled(native, index);
    else {
      setEnabled(available, index);
      useContainerTrack(index).catch((error) => console.warn('Unable to select audio track', error));
    }
    host.setPressed(true);
  };

  const discover = async (url) => {
    const player = host.player;
    if (blobUrl && discoveredTracks.length > 1 && (player.src === blobUrl || player.currentSrc === blobUrl)) {
      updateVisibility();
      if (host.modal && host.modal.classList.contains('show')) render();
      return;
    }
    if (!url || url.startsWith('blob:') || host.isAudio(url) || nativeTracks(player).length > 1) return;
    const token = ++discoverToken;
    try {
      const playable = await host.getPlayableUrl(url);
      if (token !== discoverToken || mediaUrl() !== url) return;
      const found = await global.mp4Audio.readTracks(playable);
      if (token !== discoverToken || mediaUrl() !== url || nativeTracks(player).length > 1) return;
      const normalized = found.map((track) => ({
        label: track.label,
        language: global.mediaLanguage.normalize(track.language),
        enabled: false
      }));
      const preference = preferenceByFolder.get(folderKey(url));
      const match = normalized.length > 1 ? global.mediaLanguage.matchTrack(normalized, preference) : -1;
      const selected = match >= 0 ? match : 0;
      normalized.forEach((track, index) => { track.enabled = index === selected; });
      discoveredUrl = url;
      discoveredTracks = normalized;
      updateVisibility();
      if (host.modal && host.modal.classList.contains('show')) render();
      if (selected > 0) await useContainerTrack(selected);
    } catch (error) {
      if (token !== discoverToken) return;
      console.warn('Unable to read audio tracks', error);
      discoveredTracks = [];
      discoveredUrl = url;
      updateVisibility();
    }
  };

  const refresh = (opts = {}) => {
    const list = host.player && host.player.audioTracks;
    if (list && typeof list.addEventListener === 'function' && !boundLists.has(list)) {
      boundLists.add(list);
      list.addEventListener('addtrack', () => refresh({ applyPreference: true }));
      list.addEventListener('removetrack', () => refresh());
      list.addEventListener('change', () => {
        if (!applying && host.modal && host.modal.classList.contains('show')) render();
      });
    }
    const url = mediaUrl();
    if (nativeTracks(host.player).length > 1) {
      if (opts.applyPreference && url && appliedFor !== url) {
        const preference = preferenceByFolder.get(folderKey(url));
        const native = nativeTracks(host.player);
        const index = global.mediaLanguage.matchTrack(native, preference);
        if (index >= 0) {
          applying = true;
          const already = native[index].enabled && native.every((track, i) => track.enabled === (i === index));
          if (!already) setEnabled(native, index);
          applying = false;
        }
        appliedFor = url;
      }
      updateVisibility();
      if (host.modal && host.modal.classList.contains('show')) render();
      return;
    }
    if (opts.applyPreference && url) discover(url);
    else {
      updateVisibility();
      if (host.modal && host.modal.classList.contains('show')) render();
    }
  };

  const reset = () => {
    discoverToken += 1;
    rewriteGeneration += 1;
    discoveredTracks = [];
    discoveredUrl = '';
    appliedFor = '';
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = '';
    }
    host.body.classList.add('no-audio-tracks');
  };

  return { tracks, render, refresh, reset, select };
};

global.createAudioTrackSwitcher = createAudioTrackSwitcher;
