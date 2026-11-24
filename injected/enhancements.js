/* Optional companion features injected into the Nerimity site (page context). */
(() => {
  if (window.__neriExtrasLoaded) return;
  window.__neriExtrasLoaded = true;

  const API = window.NeriExtras;
  if (!API) {
    console.warn('[NeriExtras] preload API unavailable');
    return;
  }

  const state = {
    folder: '',
    files: [],
    mode: 'clean',
    cleanCtx: null,
    cleanDest: null,
    invertGain: null,
    cleanSources: new WeakMap(),
    portalSource: null,
    iconCache: new Map(),
    // TTS
    ttsEnabled: false,
    ttsMode: 'all', // 'all' | 'selected'
    ttsUsers: [], // selected usernames (lowercase)
    ttsVoice: '',
    ttsLocale: 'auto',
    ttsRate: 1,
    ttsEngine: 'system',
    ttsSeen: new Set(),
    ttsQueue: [],
    ttsSpeaking: false,
    ttsLastSpoken: '',
    ttsWasInCall: false,
    pwIsolated: false,
    venmicInclude: [],
    venmicEnabled: false,
  };

  const log = (...args) => console.log('[NeriExtras]', ...args);
  window.__neriState = state;

  function toast(message, kind = '') {
    let host = document.getElementById('neri-extras-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'neri-extras-toasts';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'neri-extras-toast' + (kind ? ' ' + kind : '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // -------------------------------------------------------------------------
  // "clean" mode: cancel Nerimity's own audio during screen sharing.
  // -------------------------------------------------------------------------
  function ensureCleanGraph() {
    if (state.cleanCtx) return state.cleanCtx;
    state.cleanCtx = new AudioContext();
    state.cleanDest = state.cleanCtx.createMediaStreamDestination();
    state.invertGain = state.cleanCtx.createGain();
    state.invertGain.gain.value = -1;
    state.invertGain.connect(state.cleanDest);
    state.cleanCtx.resume().catch(() => {});
    return state.cleanCtx;
  }

  function registerOwnAudio(el) {
    try {
      const ctx = ensureCleanGraph();
      if (state.cleanSources.has(el)) return;
      const source = ctx.createMediaElementSource(el);
      source.connect(ctx.destination);
      source.connect(state.invertGain);
      state.cleanSources.set(el, source);
    } catch (_) {}
  }

  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    registerOwnAudio(this);
    return originalPlay.apply(this, args);
  };

  const originalGetDisplayMedia =
    navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

  async function waitForVenmicDevice(timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const ven = devs.find((d) => d.kind === 'audioinput' && /vencord-screen-share/i.test(d.label || ''));
      if (ven) return ven;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }

  navigator.mediaDevices.getDisplayMedia = async function (constraints = {}) {
    const wantAudio = !!constraints.audio;
    let venmicInclude = [];
    if (wantAudio) {
      try {
        venmicInclude = await openVenmicPicker();
      } catch (e) { log('venmic picker erro', e); }
    }
    const stream = await originalGetDisplayMedia(constraints);
    try {
      if (wantAudio && venmicInclude && venmicInclude.length) {
        await API.venmicStart(venmicInclude);
        const dev = await waitForVenmicDevice();
        if (dev) {
          const mic = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: dev.deviceId }, autoGainControl: false, echoCancellation: false, noiseSuppression: false, channelCount: 2, sampleRate: 48000 },
          }).catch(() => null);
          if (mic) {
            stream.getAudioTracks().forEach((t) => { stream.removeTrack(t); try { t.stop(); } catch (_) {} });
            mic.getAudioTracks().forEach((t) => stream.addTrack(t));
            stream.getVideoTracks()[0]?.addEventListener('ended', () => { API.venmicStop().catch(() => {}); mic.getTracks().forEach((t) => t.stop()); }, { once: true });
            log('venmic audio aplicado');
            return stream;
          }
        }
        toast("Couldn't use the selected audio; falling back to default audio", 'error');
        await API.venmicStop().catch(() => {});
      }

      const mode = (await API.getSetting('screenShareAudioMode', 'clean')) || 'clean';
      state.mode = mode;
      if (constraints.audio && mode === 'clean') {
        const ownTrack = stream.getAudioTracks()[0];
        if (ownTrack) {
          const ctx = ensureCleanGraph();
          if (state.portalSource) {
            try { state.portalSource.disconnect(); } catch (_) {}
          }
          state.portalSource = ctx.createMediaStreamSource(new MediaStream([ownTrack]));
          state.portalSource.connect(state.cleanDest);
          stream.removeTrack(ownTrack);
          stream.addTrack(state.cleanDest.stream.getAudioTracks()[0]);
          log('clean mode applied to screen share');
        }
      } else if (constraints.audio && mode !== 'full') {
        stream.getAudioTracks().forEach((track) => {
          stream.removeTrack(track);
          try { track.stop(); } catch (_) {}
        });
        if (mode === 'silent') {
          const ctx = new AudioContext();
          const dest = ctx.createMediaStreamDestination();
          const silentTrack = dest.stream.getAudioTracks()[0];
          stream.addTrack(silentTrack);
          silentTrack.addEventListener('ended', () => ctx.close().catch(() => {}));
        }
      }
    } catch (error) {
      log('failed to filter screen audio:', error);
    }
    return stream;
  };

  async function openVenmicPicker() {
    async function fetchApps() {
      const res = await API.venmicList().catch(() => ({ ok: false, targets: [], error: 'failed to list' }));
      const targets = (res?.targets || []).filter((t) => t['media.class'] !== 'Stream/Input/Audio');
      return {
        ok: !!res?.ok,
        apps: [...new Set(targets.map((t) => t['application.name']).filter(Boolean))].sort(),
        error: res?.error || '',
      };
    }
    let { apps, error } = await fetchApps();
    return new Promise((resolve) => {
      const old = document.getElementById('neri-venmic-modal'); if (old) old.remove();
      const modal = document.createElement('div');
      modal.id = 'neri-venmic-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px)';
      modal.innerHTML = `<div class="neri-extras-popover" style="width:min(380px,calc(100vw - 24px))"><div class="neri-extras-card"><div class="neri-extras-head neri-extras-drag"><span><span class="material-symbols-rounded">graphic_eq</span> Broadcast audio</span><button class="neri-extras-close" data-act="close" title="Close">&times;</button></div>
        <p>Select which apps to include in the stream. Close this window to use the system default audio.</p>
        <div id="neri-venmic-list" style="max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:6px;margin:8px 0"></div>
        <div class="neri-extras-row" style="gap:8px">
          <button data-act="refresh" class="scan-btn" title="Scan again for audio apps" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px"><span class="material-symbols-rounded" style="font-size:18px">refresh</span> Scan for audio apps</button>
          <button data-act="ok" class="primary" style="flex:1">Share selected</button>
        </div>
        <div id="neri-venmic-status" style="font-size:12px;color:#aaa;margin-top:8px;min-height:16px"></div></div></div>`;
      document.body.appendChild(modal);
      makePopoverDraggable(modal.querySelector('.neri-extras-popover'));
      const list = modal.querySelector('#neri-venmic-list');
      const status = modal.querySelector('#neri-venmic-status');
      const renderList = () => {
        list.innerHTML = '';
        if (!apps.length) {
          list.innerHTML = `<div style="opacity:.7;font-size:13px">No audio apps detected.${error ? ` <span style="opacity:.7">(${String(error)})</span>` : ''}</div>`;
          return;
        }
        apps.forEach((name) => {
          const label = document.createElement('label');
          label.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:13px';
          const checked = state.venmicInclude.some((i) => i['application.name'] === name) ? 'checked' : '';
          label.innerHTML = `<input type="checkbox" value="${name.replace(/"/g,'&quot;')}" ${checked}> <span>${name}</span>`;
          list.appendChild(label);
        });
      };
      renderList();
      let done = false;
      const finish = (val) => { if (done) return; done = true; modal.remove(); resolve(val); };
      modal.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-act]');
        const act = btn?.getAttribute('data-act');
        if (act === 'close') return finish([]);
        if (act === 'refresh') {
          e.preventDefault();
          btn.disabled = true;
          status.textContent = 'Scanning for audio apps...';
          const r = await fetchApps();
          apps = r.apps; error = r.error;
          renderList();
          status.textContent = `Scan complete — ${apps.length} audio app(s) found. Start playback in an app if it is missing.`;
          btn.disabled = false;
          return;
        }
        if (act === 'ok') {
          const selected = [...list.querySelectorAll('input:checked')].map((i) => ({ 'application.name': i.value }));
          state.venmicInclude = selected;
          finish(selected);
        }
      });
    });
  }

  // Click-to-record voice messages patch removed: keep the site's native behavior.

  // -------------------------------------------------------------------------
  // 2) TTS: read chat messages while the user is in a voice call.
  // -------------------------------------------------------------------------
  function isInCall() {
    return Boolean(
      document.querySelector('[class*="headerVoiceParticipants"]') ||
      document.querySelector('[class*="InVoiceActions"]') ||
      document.querySelector('[class*="inVoiceActions"]') ||
      document.querySelector('[class*="voiceActions"]') ||
      document.querySelector('[class*="callParticipants"]') ||
      document.querySelector('[class*="VoiceHeader"]') ||
      document.querySelector('[class*="voiceHeader"]') ||
      document.querySelector('[class*="InCall"]') ||
      document.querySelector('#neri-extras-buttons')
    );
  }

  function cleanTextForTTS(raw) {
    if (!raw) return '';
    let text = raw;
    // Remove URLs
    text = text.replace(/https?:\/\/\S+/gi, ' ');
    // Remove markdown links [text](url)
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // Remove common mentions/markup
    text = text.replace(/<@!?\d+>/g, ' ');
    text = text.replace(/:[a-zA-Z0-9_+-]+:/g, ' '); // emojis :nome:
    text = text.replace(/```[\s\S]*?```/g, ' code block ');
    text = text.replace(/`[^`]+`/g, ' ');
    text = text.replace(/[*_~>|#]/g, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  function messageText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(
      'img, video, audio, canvas, iframe, [class*="embed"], [class*="Embed"], ' +
      '[class*="attachment"], [class*="Attachment"], [class*="reactions"], ' +
      '[class*="Reactions"], [class*="floatOptions"], [class*="reply"], ' +
      'button, [class*="audio"], [class*="Audio"], [class*="translation"], ' +
      '[class*="username"], [class*="Username"], [class*="details"], [class*="Details"], ' +
      '[class*="timestamp"], [class*="Timestamp"], [class*="time"], [class*="badge"], ' +
      '[class*="Badge"], [class*="role"], [class*="Role"], [class*="avatar"], [class*="Avatar"], ' +
      '[class*="presence"], [class*="status"], [class*="replyContent"]'
    ).forEach((n) => n.remove());
    return cleanTextForTTS(clone.textContent || '');
  }

  function messageAuthor(el) {
    // Take only the username's direct text, avoiding duplicated badges/icons.
    const node = el.querySelector('[class*="username"]');
    if (!node) return '';
    // Clone and remove icons/badges/roles that could pollute the text.
    const c = node.cloneNode(true);
    c.querySelectorAll('svg, img, [class*="badge"], [class*="Badge"], [class*="role"], [class*="Role"], [class*="bot"]').forEach(n => n.remove());
    const text = (c.textContent || '').replace(/\s+/g, ' ').trim();
    // Evita "nome nome" duplicado simples
    const parts = text.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      const half = Math.floor(parts.length / 2);
      const a = parts.slice(0, half).join(' ').toLowerCase();
      const b = parts.slice(half).join(' ').toLowerCase();
      if (a && a === b) return parts.slice(0, half).join(' ');
    }
    return text;
  }

  function messageId(el) {
    return el.id || el.getAttribute('data-message-id') || '';
  }

  function shouldRead(author) {
    if (state.ttsMode === 'all') return true;
    const a = author.toLowerCase();
    return state.ttsUsers.some((u) => a.includes(u) || u.includes(a));
  }

  function pickVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (!voices.length) return null;
    if (state.ttsVoice) {
      const exact = voices.find((v) => v.name === state.ttsVoice);
      if (exact) return exact;
    }
    return (
      voices.find((v) => /pt[-_]?BR/i.test(v.lang)) ||
      voices.find((v) => /^pt/i.test(v.lang)) ||
      voices.find((v) => v.default) ||
      voices[0]
    );
  }

  try {
    window.speechSynthesis?.getVoices?.();
    window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
      const vs = window.speechSynthesis.getVoices();
      log('TTS vozes carregadas:', vs.length);
    });
  } catch (_) {}
  document.addEventListener('click', () => { try { window.speechSynthesis?.resume?.(); } catch (_) {} }, true);

  const LOCALE_BY_NAME = {
    português: 'pt-BR', portugues: 'pt-BR', 'português (brasil)': 'pt-BR',
    'portuguese (brazil)': 'pt-BR', 'pt-br': 'pt-BR',
    english: 'en-US', 'english (us)': 'en-US', 'inglês': 'en-US',
    español: 'es-ES', espanhol: 'es-ES', spanish: 'es-ES',
    français: 'fr-FR', francês: 'fr-FR', french: 'fr-FR',
    deutsch: 'de-DE', alemão: 'de-DE', german: 'de-DE',
    italiano: 'it-IT', italian: 'it-IT',
    русский: 'ru-RU', russian: 'ru-RU',
    日本語: 'ja-JP', japanese: 'ja-JP',
    한국어: 'ko-KR', korean: 'ko-KR',
    '简体中文': 'zh-CN', chinese: 'zh-CN',
  };

  function localeFromValue(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^[a-z]{2,3}(?:[-_][a-z]{2,4})?$/i.test(raw)) {
      return raw.replace(/_/g, '-');
    }
    const named = LOCALE_BY_NAME[raw.toLowerCase().replace(/\s+/g, ' ')];
    if (named) return named;
    const match = raw.match(
      /["']?(?:locale|language|lang|idioma)["']?\s*[:=]\s*["']?([a-z]{2,3}(?:[-_][a-z]{2,4})?)["']?/i
    );
    return match ? match[1].replace(/_/g, '-') : '';
  }

  // Idioma configurado no Nerimity/site, com fallback para o navegador/sistema.
  function detectPageLocale() {
    const candidates = [];
    if (document.documentElement?.lang) candidates.push(document.documentElement.lang);
    try {
      for (const key of Object.keys(localStorage)) {
        if (!/lang|locale|idioma|i18n/i.test(key)) continue;
        const found = localeFromValue(localStorage.getItem(key));
        if (found) candidates.push(found);
      }
    } catch (_) {}
    if (navigator.language) candidates.push(navigator.language);
    return candidates.find(Boolean) || '';
  }

  function ttsPayload(text) {
    return {
      text,
      rate: state.ttsRate || 1,
      pitch: 50,
      language:
        state.ttsLocale && state.ttsLocale !== 'auto'
          ? state.ttsLocale
          : detectPageLocale(),
      voice: state.ttsVoice || '',
      engine: 'edge',
    };
  }

  async function speakNext() {
    if (state.ttsSpeaking || !state.ttsQueue.length || !state.ttsEnabled) return;
    const item = state.ttsQueue.shift();
    state.ttsSpeaking = true;
    try {
      const r = await API.ttsSpeak(ttsPayload(item.text));
      if (!r?.ok) log('TTS falhou:', r?.error);
    } catch (e) {
      log('TTS erro:', e);
    }
    state.ttsSpeaking = false;
    speakNext();
  }

  function enqueueTTS(author, text) {
    if (!state.ttsEnabled || !text) return;
    if (!shouldRead(author)) return;
    const cleanAuthor = (author || '').replace(/\s+/g, ' ').trim();
    const cleanMsg = (text || '').replace(/\s+/g, ' ').trim();
    if (!cleanMsg) return;
    const key = (cleanAuthor + '|' + cleanMsg).toLowerCase();
    if (state.ttsLastSpoken === key) return; // avoid repeating the same message
    state.ttsLastSpoken = key;
    const prefix = cleanAuthor ? cleanAuthor + ' disse: ' : '';
    const full = (prefix + cleanMsg).slice(0, 500);
    state.ttsQueue.push({ author: cleanAuthor, text: full });
    speakNext();
  }

  function scanMessages() {
    if (!state.ttsEnabled || !isInCall()) return;
    const items = document.querySelectorAll('.messageItem, [class*="messageItem"], [class*="MessageItem"]');
    items.forEach((el) => {
      if (el.dataset.neriTtsSeen === '1') return;
      // Skip nested items: only read the outermost message container.
      if (el.parentElement?.closest('.messageItem, [class*="messageItem"], [class*="MessageItem"]')) return;
      el.dataset.neriTtsSeen = '1';
      if (!state.ttsReady) return;
      const author = messageAuthor(el);
      const text = messageText(el);
      if (!text || text.length < 2) return;
      if (/^(gif|enviar|send|edit|reply|edited)$/i.test(text)) return;
      enqueueTTS(author, text);
    });
  }

  function startTTS() {
    document.querySelectorAll('.messageItem, [class*="messageItem"], [class*="MessageItem"]').forEach((el) => {
      el.dataset.neriTtsSeen = '1';
    });
    state.ttsLastSpoken = '';
    state.ttsReady = true;
    state.ttsEnabled = true;
    if (!isInCall()) {
      toast('TTS enabled — join a voice call to start reading', 'error');
    } else {
      toast('TTS enabled — reading new messages in the call');
    }
    updateButtons();
  }

  function stopTTS() {
    state.ttsEnabled = false;
    state.ttsQueue = [];
    state.ttsSpeaking = false;
    try { speechSynthesis.cancel(); } catch (_) {}
    toast('TTS disabled');
    updateButtons();
  }

  // -------------------------------------------------------------------------
  // Soundboard / Soundux
  // -------------------------------------------------------------------------
  async function playSound(file) {
    try {
      const dataUrl = await API.readAudioFile(file.path);
      if (!dataUrl) throw new Error('empty or unreadable file');
      const audio = new Audio();
      audio.src = dataUrl;
      audio.volume = 1;
      audio.preload = 'auto';
      await audio.play();
      toast('Playing: ' + file.name);
    } catch (error) {
      log('playSound error', error);
      toast('Error playing ' + file.name + ': ' + (error?.message || error), 'error');
    }
  }

  function renderSoundList(container) {
    container.innerHTML = '';
    if (!state.files.length) {
      container.textContent = 'No .mp3, .wav or .flac files found.';
      return;
    }
    state.files.forEach((file) => {
      const button = document.createElement('button');
      button.className = 'neri-extras-sound';
      const mark = document.createElement('span');
      mark.className = 'material-symbols-rounded';
      mark.textContent = 'play_arrow';
      button.appendChild(mark);
      const label = document.createElement('span');
      label.textContent = file.name;
      button.appendChild(label);
      button.addEventListener('click', () => playSound(file));
      container.appendChild(button);
    });
  }

  async function openSoundModal() {
    const existing = document.getElementById('neri-extras-modal');
    if (existing) { existing.remove(); return; }
    state.folder = state.folder || (await API.getSetting('soundFolder', ''));

    const panel = document.createElement('div');
    panel.id = 'neri-extras-modal';
    panel.className = 'neri-extras-popover';
    panel.innerHTML = `
      <div class="neri-extras-card">
        <div class="neri-extras-head neri-extras-drag" title="Drag to move">
          <span><span class="material-symbols-rounded">graphic_eq</span> Soundboard</span>
          <button class="neri-extras-close" data-act="close" title="Close">&times;</button>
        </div>
        <p>Where is the folder with audio files to play in the Nerimity call?</p>
        <div class="neri-extras-row">
          <input id="neri-extras-folder" type="text" placeholder="/path/to/audio/folder" />
          <button data-act="browse">Browse</button>
        </div>
        <div class="neri-extras-row">
          <button data-act="save" class="primary">Save and use soundboard</button>
          <button data-act="soundux">Open Soundux</button>
        </div>
        <div id="neri-extras-sounds" class="neri-extras-sounds"></div>
      </div>`;

    panel.style.position = 'fixed';
    panel.style.left = '50%';
    panel.style.top = '50%';
    panel.style.transform = 'translate(-50%, -50%)';
    panel.style.zIndex = '2147483002';
    document.body.appendChild(panel);
    makePopoverDraggable(panel);

    const input = panel.querySelector('#neri-extras-folder');
    input.value = state.folder;
    const list = panel.querySelector('#neri-extras-sounds');
    if (state.folder) {
      state.files = await API.listAudioFiles(state.folder);
      renderSoundList(list);
    }

    panel.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-act]')?.getAttribute('data-act');
      if (!action) return;
      if (action === 'close') panel.remove();
      if (action === 'browse') {
        const picked = await API.chooseAudioFolder();
        if (picked) input.value = picked;
      }
      if (action === 'save') {
        state.folder = input.value.trim();
        if (!state.folder) return toast('Choose a folder first', 'error');
        await API.setSetting('soundFolder', state.folder);
        state.files = await API.listAudioFiles(state.folder);
        renderSoundList(list);
        toast(state.files.length + ' audio file(s) loaded');
      }
      if (action === 'soundux') {
        const folder = input.value.trim() || state.folder;
        if (!folder) return toast('Choose a folder first', 'error');
        await API.setSetting('soundFolder', folder);
        toast('Opening Soundux...');
        const result = await API.openSoundux(folder);
        if (!result.ok) toast('Failed to open Soundux: ' + (result.error || ''), 'error');
      }
    });
  }

  // -------------------------------------------------------------------------
  // Modal TTS
  // -------------------------------------------------------------------------
  function makePopoverDraggable(popover) {
    const handle = popover.querySelector('.neri-extras-drag');
    if (!handle) return;
    handle.style.cursor = 'grab';
    let dragging = false;
    let sx = 0, sy = 0, sl = 0, st = 0;
    const onMove = (e) => {
      if (!dragging) return;
      popover.style.left = (sl + (e.clientX - sx)) + 'px';
      popover.style.top = (st + (e.clientY - sy)) + 'px';
      popover.style.right = 'auto';
      popover.style.bottom = 'auto';
      popover.style.transform = 'none';
    };
    const onUp = () => { dragging = false; handle.style.cursor = 'grab'; document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button,input,select,textarea')) return;
      dragging = true;
      handle.style.cursor = 'grabbing';
      const r = popover.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top;
      popover.style.position = 'fixed';
      popover.style.left = sl + 'px'; popover.style.top = st + 'px';
      popover.style.right = 'auto'; popover.style.bottom = 'auto'; popover.style.transform = 'none';
      document.body.appendChild(popover);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      e.preventDefault();
    });
  }

  function openTTSModal() {
    const existing = document.getElementById('neri-tts-modal');
    if (existing) { existing.remove(); return; }
    const overlay = document.createElement('div');
    overlay.id = 'neri-tts-modal';
    overlay.className = 'neri-extras-popover';
    overlay.innerHTML = `
      <div class="neri-extras-card">
        <div class="neri-extras-head neri-extras-drag" title="Drag to move">
          <span><span class="material-symbols-rounded">record_voice_over</span> Chat reader (TTS)</span>
          <button class="neri-extras-close" data-act="close" title="Close">&times;</button>
        </div>
        <p>Reads new chat messages aloud while you are in a voice call. Links and media are ignored.</p>
        <div class="neri-extras-row" style="flex-direction:column;align-items:stretch;gap:10px">
          <label style="display:flex;gap:8px;align-items:center"><input type="radio" name="tts-mode" value="all"> Read all messages</label>
          <label style="display:flex;gap:8px;align-items:center"><input type="radio" name="tts-mode" value="selected"> Read only from selected users</label>
          <input id="neri-tts-users" type="text" placeholder="usernames separated by commas" />
          <label style="font-size:13px;color:#aaa">Speed: <span id="neri-tts-rate-val"></span></label>
          <input id="neri-tts-rate" type="range" min="0.7" max="1.6" step="0.1" />
          <label style="font-size:13px;color:#aaa">Voice language</label>
          <select id="neri-tts-locale">
            <option value="auto">Automatic (Nerimity / system)</option>
            <option value="pt-BR">Portuguese (Brazil)</option>
            <option value="pt-PT">Portuguese (Portugal)</option>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="es-ES">Spanish (Spain)</option>
            <option value="es-MX">Spanish (Mexico)</option>
            <option value="fr-FR">French</option>
            <option value="de-DE">German</option>
            <option value="it-IT">Italian</option>
            <option value="ru-RU">Russian</option>
            <option value="ja-JP">Japanese</option>
            <option value="ko-KR">Korean</option>
            <option value="zh-CN">Chinese</option>
            <option value="ar-SA">Arabic</option>
            <option value="hi-IN">Hindi</option>
          </select>
          <input id="neri-tts-voice" type="text" placeholder="Custom voice (e.g. pt-BR-FranciscaNeural)" />
          <div id="neri-tts-detected" style="font-size:12px;color:#888"></div>
          <div id="neri-tts-diag" style="font-size:12px;color:#888"></div>
        </div>
        <div class="neri-extras-row">
          <button data-act="toggle" class="primary"></button>
          <button data-act="test">Test voice</button>
        </div>
      </div>`;
    overlay.style.position = 'fixed';
    overlay.style.left = '50%';
    overlay.style.top = '50%';
    overlay.style.transform = 'translate(-50%, -50%)';
    overlay.style.zIndex = '2147483002';
    document.body.appendChild(overlay);
    makePopoverDraggable(overlay);

    const modeAll = overlay.querySelector('input[value="all"]');
    const modeSel = overlay.querySelector('input[value="selected"]');
    const usersInput = overlay.querySelector('#neri-tts-users');
    const rate = overlay.querySelector('#neri-tts-rate');
    const rateVal = overlay.querySelector('#neri-tts-rate-val');
    const localeSel = overlay.querySelector('#neri-tts-locale');
    const voiceInput = overlay.querySelector('#neri-tts-voice');
    const detected = overlay.querySelector('#neri-tts-detected');
    const toggleBtn = overlay.querySelector('[data-act="toggle"]');
    const diag = overlay.querySelector('#neri-tts-diag');
    modeAll.checked = state.ttsMode === 'all';
    modeSel.checked = state.ttsMode === 'selected';
    usersInput.value = state.ttsUsers.join(', ');
    rate.value = String(state.ttsRate || 1);
    rateVal.textContent = rate.value + 'x';
    localeSel.value = state.ttsLocale || 'auto';
    voiceInput.value = state.ttsVoice || '';
    const autoLocale = detectPageLocale();
    detected.textContent = `Detected language: ${autoLocale || 'not detected (using pt-BR default)'}`;
    toggleBtn.textContent = state.ttsEnabled ? 'Disable TTS' : 'Enable TTS';
    const updateDiag = () => {
      const inCall = isInCall();
      const lang =
        state.ttsLocale && state.ttsLocale !== 'auto'
          ? state.ttsLocale
          : autoLocale || 'automatic';
      diag.textContent = `Engine: embedded edge-tts | Language: ${lang} | Voice: ${state.ttsVoice || 'automatic'} | In call: ${inCall ? 'yes' : 'no'} | Queue: ${state.ttsQueue.length}`;
    };
    updateDiag();

    const applySettings = async () => {
      state.ttsMode = modeSel.checked ? 'selected' : 'all';
      state.ttsUsers = usersInput.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      state.ttsRate = parseFloat(rate.value) || 1;
      state.ttsLocale = localeSel.value || 'auto';
      state.ttsVoice = voiceInput.value.trim();
      state.ttsEngine = 'edge';
      await API.setSetting('ttsMode', state.ttsMode);
      await API.setSetting('ttsUsers', state.ttsUsers);
      await API.setSetting('ttsRate', state.ttsRate);
      await API.setSetting('ttsLocale', state.ttsLocale);
      await API.setSetting('ttsVoice', state.ttsVoice);
      await API.setSetting('ttsEngine', 'edge');
      updateDiag();
    };
    rate.addEventListener('input', () => { rateVal.textContent = rate.value + 'x'; applySettings(); });
    modeAll.addEventListener('change', applySettings);
    modeSel.addEventListener('change', applySettings);
    usersInput.addEventListener('change', applySettings);
    localeSel.addEventListener('change', applySettings);
    voiceInput.addEventListener('change', applySettings);

    overlay.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-act]')?.getAttribute('data-act');
      if (!action) return;
      if (action === 'close') overlay.remove();
      if (action === 'toggle') {
        await applySettings();
        if (state.ttsEnabled) stopTTS(); else startTTS();
        toggleBtn.textContent = state.ttsEnabled ? 'Disable TTS' : 'Enable TTS';
        updateDiag();
      }
      if (action === 'test') {
        await applySettings();
        const text = 'Nerimity chat read-aloud test';
        toast('Testing voice...');
        const r = await API.ttsSpeak(ttsPayload(text));
        toast(r?.ok ? `TTS test OK (${r.backend})` : 'TTS failed: ' + (r?.error || 'unknown error'), r?.ok ? '' : 'error');
        updateDiag();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Buttons injected into the native call bar
  // -------------------------------------------------------------------------
  function findCallBar() {
    return document.querySelector('[class*="voiceActions"]');
  }

  async function iconMarkup(name) {
    if (state.iconCache.has(name)) return state.iconCache.get(name);
    let svg = '';
    try {
      const res = await fetch('https://nerimity.com/msr/' + name + '-fill.svg');
      if (res.ok) {
        svg = await res.text();
        svg = svg.replace(/width="48"/, 'width="24"').replace(/height="48"/, 'height="24"').replace(/fill="[^"]*"/, 'fill="currentColor"');
      }
    } catch (_) {}
    state.iconCache.set(name, svg);
    return svg;
  }

  function makeButton(template, name, color, act, title) {
    const button = template.cloneNode(true);
    button.removeAttribute('data-type');
    button.setAttribute('data-neri-extra', '1');
    button.setAttribute('data-act', act);
    button.setAttribute('title', title);
    button.innerHTML = '';
    const iconTemplate = template.querySelector('span.icon');
    const span = iconTemplate ? iconTemplate.cloneNode(false) : document.createElement('span');
    if (!iconTemplate) span.className = 'icon';
    span.style.setProperty('--icon-color', color);
    span.style.width = '24px';
    span.style.height = '24px';
    span.setAttribute('data-neri-icon', name);
    button.appendChild(span);
    iconMarkup(name).then((svg) => { if (span.isConnected && svg) span.innerHTML = svg; });
    return button;
  }

  function audioIconName() {
    return state.mode === 'full' || state.mode === 'isolate' ? 'volume_up' : state.mode === 'clean' ? 'volume_down' : 'volume_off';
  }

  function updateButtons() {
    const host = document.getElementById('neri-extras-buttons');
    if (!host) return;

    const tts = host.querySelector('[data-act="tts"]');
    if (tts) {
      tts.classList.toggle('active', state.ttsEnabled);
      const span = tts.querySelector('span.icon');
      tts.setAttribute('title', state.ttsEnabled ? 'TTS: enabled (click to configure/disable)' : 'Chat reader (TTS)');
      if (span) span.style.setProperty('--icon-color', state.ttsEnabled ? 'var(--success-color)' : 'rgba(255,255,255,0.6)');
    }
  }

  function ensureNativeButtons() {
    const bar = findCallBar();
    if (!bar || bar.querySelector('#neri-extras-buttons')) return;
    let template =
      [...bar.querySelectorAll('button')].find((b) => !b.querySelector('.label')) ||
      bar.querySelector('button');
    if (!template) {
      template = document.createElement('button');
      template.className = 'button';
      template.innerHTML = '<span class="icon" style="--icon-color:#fff;width:24px;height:24px"></span>';
    }

    const host = document.createElement('div');
    host.id = 'neri-extras-buttons';
    host.style.display = 'flex';
    host.style.flexShrink = '0';
    host.style.alignItems = 'center';

    host.appendChild(makeButton(template, 'record_voice_over', 'rgba(255,255,255,0.6)', 'tts', 'Chat reader (TTS)'));

    host.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-act]')?.getAttribute('data-act');
      if (action === 'tts') openTTSModal();
    });

    const leave = [...bar.querySelectorAll('button.button')].find((b) => b.querySelector('.label'));
    if (leave) bar.insertBefore(host, leave); else bar.appendChild(host);
    updateButtons();
    log('native buttons injected into the call bar');
  }

  async function init() {
    state.mode = (await API.getSetting('screenShareAudioMode', 'clean')) || 'clean';
    state.ttsMode = (await API.getSetting('ttsMode', 'all')) || 'all';
    state.ttsUsers = (await API.getSetting('ttsUsers', [])) || [];
    state.ttsRate = (await API.getSetting('ttsRate', 1)) || 1;
    state.ttsLocale = (await API.getSetting('ttsLocale', 'auto')) || 'auto';
    state.ttsVoice = (await API.getSetting('ttsVoice', '')) || '';
    state.ttsEngine = 'edge';
    if (!(await API.getSetting('audioModeMigratedV2', false))) {
      state.mode = 'clean';
      await API.setSetting('screenShareAudioMode', 'clean');
      await API.setSetting('audioModeMigratedV2', true);
    }
    state.folder = (await API.getSetting('soundFolder', '')) || '';
    if (state.folder) state.files = await API.listAudioFiles(state.folder).catch(() => []);

    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        ensureNativeButtons();
        updateButtons();
        const inCall = isInCall();
        if (state.ttsEnabled && inCall && !state.ttsWasInCall) {
          // Rejoined the call: mark current messages as seen to avoid reading old backlog.
          document.querySelectorAll('.messageItem, [class*="messageItem"], [class*="MessageItem"]').forEach((el) => {
            el.dataset.neriTtsSeen = '1';
          });
          state.ttsQueue = [];
          state.ttsSpeaking = false;
          state.ttsLastSpoken = '';
        }
        state.ttsWasInCall = inCall;
        scanMessages();
      });
    };
    new MutationObserver(refresh).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    refresh();
    log('injetado com sucesso');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
