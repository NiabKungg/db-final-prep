/* ============================================================
   tts.js — ระบบเสียงช่วยอ่าน (Web Speech API + เสียงไทยออนไลน์)
   - ปุ่ม 🔊 อ่าน หน้าแต่ละ section (h2), หัวข้อย่อย (h3) และกล่องความรู้ (.box)
   - แถบควบคุมลอย: เลือกเสียงไทย/อังกฤษ, ความเร็ว, พัก/หยุด, อ่านทั้งหน้า
   - เครื่องที่ไม่มีเสียงไทยในตัว → ใช้ "🌐 เสียงไทยออนไลน์" (Google TTS)
     เล่นผ่าน <audio> โดยไม่ต้องใช้ API key มี host สำรอง + สลับกลับเสียงในเครื่องเมื่อเน็ตขัดข้อง
   - ไม่อ่านเฉลยที่ยังซ่อนอยู่ (details ปิด) และไม่อ่านปุ่มตอบ quiz
   ============================================================ */
'use strict';
(function () {
  if (document.body.dataset.tts !== '1') return;
  if (!('speechSynthesis' in window) && !window.Audio) return;

  const LS_KEY = 'db-final-tts';
  const THAI_RE = /[\u0E00-\u0E7F]/;
  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}\u{200D}\u{2764}]/gu;

  /* ค่า sentinel ของตัวเลือกเสียงออนไลน์ใน dropdown */
  const ONLINE_TH = '__online_th__';
  const ONLINE_EN = '__online_en__';
  /* เสียงออนไลน์: สร้าง MP3 ผ่าน SoundOfText (ฟรี, เปิด CORS *, ไม่ต้องใช้ key)
     หมายเหตุ: Google translate_tts เขียนตรง ๆ โดน Chrome บล็อกด้วย ORB แล้ว จึงต้องผ่านตัวกลางนี้ */
  const SOT_API = 'https://api.soundoftext.com';
  const SOT_VOICE_TH = 'th-TH';
  const SOT_VOICE_EN = 'en-US';
  const LS_CACHE = 'db-final-tts-urls';

  const state = {
    voiceTh: null, voiceEn: null,   // SpeechSynthesisVoice หรือ ONLINE_*
    rate: 1,
    chunks: [], idx: 0,
    playing: false, paused: false, stopped: true,
    target: null, label: '', epoch: 0,
    currentEngine: 'web',           // 'web' | 'net'
  };
  const net = { audio: null, lastReq: 0 };
  /* แคช url เสียงที่สร้างแล้ว (key = voice::text) กันสร้างซ้ำตอนอ่านซ้ำ — เก็บข้าม session ได้ 7 วัน */
  const netCache = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(LS_CACHE) || '{}');
    const now = Date.now();
    Object.keys(saved).forEach((k) => { if (now - saved[k].t < 7 * 24 * 3600 * 1000) netCache.set(k, Promise.resolve(saved[k].url)); });
  } catch (e) { /* แคชพังก็เริ่มใหม่ */ }
  function cachePut(key, url) {
    netCache.set(key, Promise.resolve(url));
    try {
      const saved = JSON.parse(localStorage.getItem(LS_CACHE) || '{}');
      saved[key] = { url, t: Date.now() };
      const keys = Object.keys(saved);
      if (keys.length > 400) {
        keys.sort((a, b) => saved[a].t - saved[b].t).slice(0, keys.length - 400).forEach((k) => delete saved[k]);
      }
      localStorage.setItem(LS_CACHE, JSON.stringify(saved));
    } catch (e) { /* เต็มก็ไม่เป็นไร */ }
  }

  /* ---------- ตั้งค่าที่บันทึกไว้ ---------- */
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (p.rate) state.rate = p.rate;
      state._savedTh = p.th || '';
      state._savedEn = p.en || '';
    } catch (e) { /* ไม่มีค่าเดิมก็ข้าม */ }
  }
  function savePrefs() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        th: typeof state.voiceTh === 'string' ? state.voiceTh : (state.voiceTh ? state.voiceTh.name : ''),
        en: typeof state.voiceEn === 'string' ? state.voiceEn : (state.voiceEn ? state.voiceEn.name : ''),
        rate: state.rate,
      }));
    } catch (e) { /* localStorage ใช้ไม่ได้ก็ไม่เป็นไร */ }
  }

  /* ---------- รายชื่อเสียงในเครื่อง ---------- */
  function allVoices() {
    if (!('speechSynthesis' in window)) return [];
    const vs = speechSynthesis.getVoices();
    const uniq = new Map();
    vs.forEach((v) => { if (!uniq.has(v.name)) uniq.set(v.name, v); });
    return [...uniq.values()];
  }
  function voiceOption(v) {
    const isTh = /^th/i.test(v.lang);
    return (isTh ? '🇹🇭 ' : '') + v.name + ' (' + v.lang + ')';
  }
  /* resolve ค่าจาก dropdown → ONLINE_* หรือ SpeechSynthesisVoice */
  function resolveSel(sel, voices) {
    const val = sel.value;
    if (val === ONLINE_TH || val === ONLINE_EN) return val;
    return voices.find((v) => v.name === val) || null;
  }
  function fillSelect(sel, opts, savedVal) {
    sel.innerHTML = '';
    opts.forEach((o) => {
      const el = document.createElement('option');
      el.value = o.value;
      el.textContent = o.label;
      sel.appendChild(el);
    });
    if (savedVal && opts.some((o) => o.value === savedVal)) sel.value = savedVal;
  }
  function refreshVoices() {
    const list = allVoices();
    const th = list.filter((v) => /^th/i.test(v.lang));
    const en = list.filter((v) => /^en/i.test(v.lang));
    /* เสียงไทย: ออนไลน์ไว้บนสุดเสมอ (ใช้ได้ทุกเครื่อง) ตามด้วยเสียงในเครื่อง */
    fillSelect(el.selTh,
      [{ value: ONLINE_TH, label: '🌐 เสียงไทยออนไลน์ (Google) — ต้องต่อเน็ต' }]
        .concat(th.map((v) => ({ value: v.name, label: voiceOption(v) }))),
      state._savedTh);
    /* เสียงอังกฤษ: ในเครื่องก่อน (ไว/ออฟไลน์) ตามด้วยออนไลน์ */
    fillSelect(el.selEn,
      en.map((v) => ({ value: v.name, label: v.name + ' (' + v.lang + ')' }))
        .concat([{ value: ONLINE_EN, label: '🌐 เสียงอังกฤษออนไลน์ (Google) — ต้องต่อเน็ต' }]),
      state._savedEn);
    state.voiceTh = resolveSel(el.selTh, th) || th[0] || ONLINE_TH;
    state.voiceEn = resolveSel(el.selEn, en) || en[0] || null;
    if (state.voiceTh) el.selTh.value = typeof state.voiceTh === 'string' ? state.voiceTh : state.voiceTh.name;
    if (state.voiceEn) el.selEn.value = typeof state.voiceEn === 'string' ? state.voiceEn : state.voiceEn.name;
    updateHint(th.length > 0);
  }
  function updateHint(hasThai) {
    el.hint.textContent = hasThai
      ? ''
      : 'เครื่องนี้ไม่มีเสียงไทยในตัว — ใช้ "🌐 เสียงไทยออนไลน์" ได้เลย (ต้องต่ออินเทอร์เน็ต) หรือจะติดตั้งเสียงไทยในระบบเพื่อใช้ออฟไลน์ก็ได้';
  }

  /* ---------- ดึงข้อความจาก DOM ---------- */
  function cleanText(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script, style, input, select, button, svg, .tts-btn, .quiz-opts, .quiz-explain, .prevnext').forEach((n) => n.remove());
    /* details ที่ยังไม่เปิด → อ่านแค่หัวข้อคำถาม ไม่หลุดอ่านเฉลยที่ซ่อนอยู่ */
    clone.querySelectorAll('details:not([open])').forEach((d) => {
      const s = d.querySelector('summary');
      d.innerHTML = '';
      if (s) d.appendChild(s.cloneNode(true));
    });
    let text = clone.textContent || '';
    text = text.replace(EMOJI_RE, ' ');
    text = text.replace(/[\t\r]+/g, ' ').replace(/[ \u00A0]+/g, ' ');
    text = text.replace(/\n{2,}/g, '\n').replace(/\n /g, '\n').trim();
    return text;
  }

  /* ---------- หั่นข้อความเป็นท่อน ๆ สำหรับอ่าน (≤185 อักขระ กัน Google TTS โดนตัด) ---------- */
  function chunkText(text) {
    const parts = text.split(/\n+/).flatMap((para) => {
      const sents = para.split(/(?<=[\.!?;:ๆ])\s+/);
      const out = [];
      for (let s of sents) {
        s = s.trim();
        if (!s) continue;
        if (s.length <= 185) { out.push(s); continue; }
        let rest = s;
        while (rest.length > 185) {
          let cut = rest.lastIndexOf(' ', 170);
          if (cut < 60) cut = 170;
          out.push(rest.slice(0, cut).trim());
          rest = rest.slice(cut).trim();
        }
        if (rest) out.push(rest);
      }
      return out;
    });
    const merged = [];
    for (const p of parts) {
      if (merged.length && (merged[merged.length - 1] + ' ' + p).length <= 185) {
        merged[merged.length - 1] += ' ' + p;
      } else merged.push(p);
    }
    return merged.filter(Boolean).map((t) => ({ text: t, thai: THAI_RE.test(t) }));
  }

  /* ---------- เครื่องยนต์อ่าน ---------- */
  function startRead(target, label) {
    const text = cleanText(target);
    if (!text) { setStatus('ไม่พบข้อความให้อ่าน'); return; }
    stopAllSilent();
    state.epoch += 1;
    state.stopped = false; state.playing = true; state.paused = false;
    state.target = target; state.label = label;
    state.chunks = chunkText(text); state.idx = 0;
    /* target ที่สร้างจากการ clone จะแนบ __anchor ไว้ที่หัวข้อต้นทางเพื่อไฮไลต์/เลื่อนจอ */
    const anchor = target.__anchor || target;
    markReading(anchor);
    if (typeof anchor.scrollIntoView === 'function') {
      try { anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* เลื่อนไม่ได้ก็อ่านต่อ */ }
    }
    el.pauseBtn.textContent = '⏸ พัก';
    speakChunk(0, state.epoch);
  }

  function chunkUsesNet(c) {
    return c.thai ? state.voiceTh === ONLINE_TH : state.voiceEn === ONLINE_EN;
  }
  function speakChunk(i, epoch) {
    if (state.stopped || epoch !== state.epoch) return;
    if (i >= state.chunks.length) { finish(); return; }
    state.idx = i;
    const c = state.chunks[i];
    if (chunkUsesNet(c)) playNet(c, i, epoch);
    else speakWeb(c, i, epoch);
  }

  /* --- เครื่องย่อย 1: เสียงในเครื่อง (Web Speech API) --- */
  function speakWeb(c, i, epoch) {
    if (!('speechSynthesis' in window)) { skipChunk(i, epoch, 'เบราว์เซอร์นี้ไม่รองรับเสียงในเครื่อง'); return; }
    state.currentEngine = 'web';
    const u = new SpeechSynthesisUtterance(c.text);
    const v = c.thai
      ? (state.voiceTh && typeof state.voiceTh !== 'string' ? state.voiceTh : null)
      : (state.voiceEn && typeof state.voiceEn !== 'string' ? state.voiceEn : null);
    if (v) u.voice = v;
    u.lang = c.thai ? 'th-TH' : 'en-US';
    u.rate = state.rate;
    u.onend = () => {
      if (epoch !== state.epoch || state.stopped || state.paused) return;
      setTimeout(() => speakChunk(i + 1, epoch), 60);
    };
    u.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled' && epoch === state.epoch) finish();
    };
    setStatus('กำลังอ่าน (' + (i + 1) + '/' + state.chunks.length + '): ' + state.label);
    speechSynthesis.speak(u);
  }

  /* --- เครื่องย่อย 2: เสียงออนไลน์ (สร้าง MP3 ผ่าน SoundOfText แล้วเล่นด้วย <audio>) --- */
  /* ขอ url เสียงจาก SoundOfText — มีแคชกันสร้างซ้ำ, POST 1 ครั้ง + poll สถานะจน Done */
  async function getNetUrl(text, sotVoice) {
    const key = sotVoice + '::' + text;
    if (netCache.has(key)) return netCache.get(key);
    const p = (async () => {
      const res = await fetch(SOT_API + '/sounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: 'google', data: { text, voice: sotVoice } }),
      });
      if (!res.ok) throw new Error('POST ' + res.status);
      const j = await res.json();
      if (!j.success || !j.id) throw new Error(j.message || 'สร้างเสียงไม่สำเร็จ');
      for (let k = 0; k < 25; k++) {
        await new Promise((r) => setTimeout(r, 700));
        const sj = await (await fetch(SOT_API + '/sounds/' + j.id)).json();
        if (sj.status === 'Done' && sj.location) return sj.location;
        if (sj.status === 'Error') throw new Error('สร้างเสียงล้มเหลว');
      }
      throw new Error('สร้างเสียงนานเกินไป');
    })();
    netCache.set(key, p);
    p.then((url) => cachePut(key, url)).catch(() => netCache.delete(key));
    return p;
  }
  function playNet(c, i, epoch) {
    state.currentEngine = 'net';
    const sotVoice = c.thai ? SOT_VOICE_TH : SOT_VOICE_EN;
    /* เว้นช่วงขออนุญาติเล็กน้อยกันยิงถี่เกิน */
    const wait = Math.max(0, 250 - (Date.now() - net.lastReq));
    setTimeout(async () => {
      if (state.stopped || epoch !== state.epoch) return;
      setStatus('กำลังเตรียมเสียง (' + (i + 1) + '/' + state.chunks.length + ') • 🌐 ออนไลน์: ' + state.label);
      let url;
      try {
        url = await getNetUrl(c.text, sotVoice);
      } catch (err) {
        /* ออนไลน์ล้ม → สลับกลับไปเสียงในเครื่องชั่วคราว */
        const fb = c.thai
          ? (state.voiceTh && typeof state.voiceTh !== 'string' ? state.voiceTh : null)
          : (state.voiceEn && typeof state.voiceEn !== 'string' ? state.voiceEn : null);
        if (fb) {
          setStatus('ออนไลน์ขัดข้อง (' + err.message + ') — สลับไปเสียงในเครื่องชั่วคราว');
          speakWeb(c, i, epoch);
        } else {
          skipChunk(i, epoch, 'โหลดเสียงออนไลน์ไม่ได้ (ตรวจอินเทอร์เน็ต)');
        }
        return;
      }
      if (state.stopped || epoch !== state.epoch) return;
      net.lastReq = Date.now();
      const a = new Audio();
      a.preload = 'auto';
      a.src = url;
      a.playbackRate = Math.min(2, Math.max(0.5, state.rate));
      net.audio = a;
      a.onended = () => {
        if (epoch !== state.epoch || state.stopped || state.paused) return;
        net.audio = null;
        setTimeout(() => speakChunk(i + 1, epoch), 60);
      };
      a.onerror = () => {
        if (epoch !== state.epoch || state.stopped) return;
        netCache.delete(sotVoice + '::' + c.text);
        skipChunk(i, epoch, 'เล่นไฟล์เสียงไม่ได้ — ข้ามท่อนนี้');
      };
      setStatus('กำลังอ่าน (' + (i + 1) + '/' + state.chunks.length + ') • 🌐 ออนไลน์: ' + state.label);
      const p = a.play();
      if (p && p.catch) p.catch(() => {
        if (epoch === state.epoch && !state.stopped) setStatus('กดปุ่ม 🔊 อ่าน อีกครั้งเพื่อเริ่มเสียง (นโยบาย autoplay ของเบราว์เซอร์)');
      });
      /* เริ่มเตรียมเสียงท่อนถัดไปล่วงหน้าให้เสียงต่อเนื่อง */
      const nxt = state.chunks[i + 1];
      if (nxt && chunkUsesNet(nxt)) getNetUrl(nxt.text, nxt.thai ? SOT_VOICE_TH : SOT_VOICE_EN).catch(() => {});
    }, wait);
  }
  function skipChunk(i, epoch, msg) {
    setStatus(msg + ' (' + (i + 1) + '/' + state.chunks.length + ')');
    setTimeout(() => speakChunk(i + 1, epoch), 0);
  }

  /* ---------- ควบคุม ---------- */
  function stopNetAudio() {
    const a = net.audio;
    if (a) {
      a.onended = null; a.onerror = null;
      try { a.pause(); } catch (e) { /* ไม่เป็นไร */ }
      a.removeAttribute('src');
      try { a.load(); } catch (e) { /* ไม่เป็นไร */ }
    }
    net.audio = null;
  }
  function stopAllSilent() {
    state.epoch += 1;
    state.stopped = true; state.playing = false; state.paused = false;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    stopNetAudio();
    clearReading();
  }
  function stopAll() {
    stopAllSilent();
    setStatus('หยุดแล้ว');
    el.pauseBtn.textContent = '⏸ พัก';
  }
  function togglePause() {
    if (!state.playing) return;
    if (state.paused) {
      if (state.currentEngine === 'net' && net.audio) { const p = net.audio.play(); if (p && p.catch) p.catch(() => {}); }
      else if ('speechSynthesis' in window) speechSynthesis.resume();
      state.paused = false;
      el.pauseBtn.textContent = '⏸ พัก';
      setStatus('กำลังอ่าน: ' + state.label);
    } else {
      if (state.currentEngine === 'net' && net.audio) net.audio.pause();
      else if ('speechSynthesis' in window) speechSynthesis.pause();
      state.paused = true;
      el.pauseBtn.textContent = '▶ เล่นต่อ';
      setStatus('พักการอ่านอยู่');
    }
  }
  function finish() {
    state.playing = false; state.paused = false; state.stopped = true;
    clearReading();
    setStatus('อ่านจบแล้ว ✓');
    el.pauseBtn.textContent = '⏸ พัก';
  }
  function setStatus(t) { el.status.textContent = t; }
  function markReading(t) { clearReading(); t.classList.add('tts-reading'); }
  function clearReading() { document.querySelectorAll('.tts-reading').forEach((n) => n.classList.remove('tts-reading')); }

  /* ---------- ปุ่ม 🔊 อ่าน ---------- */
  function makeBtn(target, label, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tts-btn' + (cls ? ' ' + cls : '');
    b.textContent = '🔊 อ่าน';
    b.setAttribute('aria-label', 'อ่านออกเสียง: ' + label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.playing && state.target === target) stopAll();
      else startRead(target, label);
    });
    return b;
  }
  /* เนื้อหาของหัวข้อ = node ถัดจากหัวข้อ จนถึงหัวข้อถัดไป (h2/h3) หรือจบหน้า */
  function headingContent(headEl, stopAt) {
    const box = document.createElement('div');
    let node = headEl.nextElementSibling;
    while (node && !stopAt.test(node.tagName)) {
      box.appendChild(node.cloneNode(true));
      node = node.nextElementSibling;
    }
    const head = headEl.cloneNode(false);
    head.textContent = headEl.textContent;
    box.prepend(head);
    return box;
  }
  function injectButtons() {
    const content = document.querySelector('main .content');
    if (!content) return;
    /* ระดับ section (h2): อ่านตั้งแต่ h2 จนถึง h2 ถัดไป */
    content.querySelectorAll('h2').forEach((h2) => {
      if (h2.querySelector('.tts-btn')) return;
      const box = headingContent(h2, /^H2$/);
      box.__anchor = h2;
      h2.appendChild(makeBtn(box, h2.textContent.replace(EMOJI_RE, '').trim().slice(0, 60), 'tts-sec'));
      /* ระดับหัวข้อย่อย (h3): อ่านเฉพาะท่อนของหัวข้อนั้น */
      let node = h2.nextElementSibling;
      while (node && node.tagName !== 'H2') {
        if (node.tagName === 'H3' && !node.querySelector('.tts-btn')) {
          const sub = headingContent(node, /^H[23]$/);
          sub.__anchor = node;
          node.appendChild(makeBtn(sub, node.textContent.replace(EMOJI_RE, '').trim().slice(0, 60), 'tts-sub'));
        }
        node = node.nextElementSibling;
      }
    });
    /* กล่องความรู้ (.box): พื้นฐาน/เปรียบเทียบ/ข้อสอบ/เคล็ดลับ/เตือน/จำ — อ่านเฉพาะกล่องนั้น */
    content.querySelectorAll('.box').forEach((box) => {
      const title = box.querySelector('.box-title');
      if (!title || title.querySelector('.tts-btn')) return;
      const name = title.textContent.replace(EMOJI_RE, '').trim().slice(0, 50);
      title.appendChild(makeBtn(box, name || 'กล่องความรู้'));
    });
  }

  /* ---------- แถบควบคุมลอย ---------- */
  const el = {};
  function buildBar() {
    const bar = document.createElement('div');
    bar.className = 'tts-bar';
    bar.innerHTML = `
      <div class="tts-bar-head">
        <span class="tts-bar-title">🔊 อ่านออกเสียง</span>
        <button type="button" class="tts-fold" aria-label="ย่อ/กางแถบควบคุม">▾</button>
      </div>
      <div class="tts-bar-body">
        <div class="tts-status" role="status">พร้อม — กดปุ่ม 🔊 อ่าน ที่หัวข้อหรือกล่องความรู้ที่ต้องการฟัง</div>
        <div class="tts-row">
          <label>เสียงไทย <select id="ttsVoiceTh" name="ttsVoiceTh" class="tts-vth"></select></label>
          <label>เสียงอังกฤษ <select id="ttsVoiceEn" name="ttsVoiceEn" class="tts-ven"></select></label>
        </div>
        <div class="tts-row">
          <label>ความเร็ว
            <select id="ttsRate" name="ttsRate" class="tts-rate">
              <option value="0.75">ช้า 0.75×</option>
              <option value="0.9">ช้านิด 0.9×</option>
              <option value="1" selected>ปกติ 1×</option>
              <option value="1.15">เร็วนิด 1.15×</option>
              <option value="1.3">เร็ว 1.3×</option>
              <option value="1.5">เร็วมาก 1.5×</option>
            </select>
          </label>
          <button type="button" class="tts-pause">⏸ พัก</button>
          <button type="button" class="tts-stop">⏹ หยุด</button>
          <button type="button" class="tts-all">📖 อ่านทั้งหน้า</button>
        </div>
        <div class="tts-hint"></div>
      </div>`;
    document.body.appendChild(bar);
    el.bar = bar;
    el.status = bar.querySelector('.tts-status');
    el.hint = bar.querySelector('.tts-hint');
    el.selTh = bar.querySelector('.tts-vth');
    el.selEn = bar.querySelector('.tts-ven');
    el.selRate = bar.querySelector('.tts-rate');
    el.pauseBtn = bar.querySelector('.tts-pause');
    bar.querySelector('.tts-fold').addEventListener('click', () => bar.classList.toggle('min'));
    el.pauseBtn.addEventListener('click', togglePause);
    bar.querySelector('.tts-stop').addEventListener('click', stopAll);
    bar.querySelector('.tts-all').addEventListener('click', () => {
      const inner = document.querySelector('main .content');
      if (state.playing && state.target === inner) stopAll();
      else startRead(inner, 'ทั้งหน้า');
    });
    el.selRate.value = String(state.rate);
    el.selRate.addEventListener('change', () => {
      state.rate = parseFloat(el.selRate.value) || 1;
      savePrefs();
      /* ถ้ากำลังอ่านอยู่ รีสตาร์ตท่อนปัจจุบันเพื่อให้ความเร็วใหม่มีผลทันที */
      if (state.playing && !state.paused) { const t = state.target, l = state.label; startRead(t, l); }
    });
    el.selTh.addEventListener('change', () => {
      state.voiceTh = resolveSel(el.selTh, allVoices().filter((v) => /^th/i.test(v.lang)));
      savePrefs();
    });
    el.selEn.addEventListener('change', () => {
      state.voiceEn = resolveSel(el.selEn, allVoices().filter((v) => /^en/i.test(v.lang)));
      savePrefs();
    });
  }

  /* ---------- เริ่มทำงาน ---------- */
  loadPrefs();
  buildBar();
  injectButtons();
  refreshVoices();
  if ('speechSynthesis' in window) {
    if (typeof speechSynthesis.addEventListener === 'function') {
      speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    } else {
      speechSynthesis.onvoiceschanged = refreshVoices;
    }
    /* เสียงบางเครื่องมาช้า — ลองโหลดซ้ำช่วงแรก */
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      if (allVoices().length || tries > 10) clearInterval(t);
      else refreshVoices();
    }, 400);
  }
  window.addEventListener('beforeunload', stopAllSilent);
})();
