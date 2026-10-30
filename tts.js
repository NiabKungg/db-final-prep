/* ============================================================
   tts.js — ระบบเสียงช่วยอ่าน (Web Speech API — ฟรี ในตัวเบราว์เซอร์)
   ดัดแปลงจากรูปแบบเดียวกับเว็บ la2569:
   - ปุ่ม 🔊 อ่าน หน้าแต่ละ section (h2), หัวข้อย่อย (h3) และกล่องความรู้ (.box)
   - แถบควบคุมลอย: เลือกเสียงไทย/อังกฤษ, ความเร็ว, พัก/หยุด, อ่านทั้งหน้า
   - ไม่อ่านเฉลยที่ยังซ่อนอยู่ (details ปิด) และไม่อ่านปุ่มตอบ quiz
   ============================================================ */
'use strict';
(function () {
  if (document.body.dataset.tts !== '1') return;
  if (!('speechSynthesis' in window)) return;

  const LS_KEY = 'db-final-tts';
  const THAI_RE = /[\u0E00-\u0E7F]/;
  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}\u{200D}\u{2764}]/gu;

  const state = {
    voiceTh: null, voiceEn: null, rate: 1,
    chunks: [], idx: 0, playing: false, paused: false, stopped: true,
    target: null, label: '', epoch: 0,
  };

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
        th: state.voiceTh ? state.voiceTh.name : '',
        en: state.voiceEn ? state.voiceEn.name : '',
        rate: state.rate,
      }));
    } catch (e) { /* localStorage ใช้ไม่ได้ก็ไม่เป็นไร */ }
  }

  /* ---------- รายชื่อเสียง ---------- */
  function allVoices() {
    const vs = speechSynthesis.getVoices();
    const uniq = new Map();
    vs.forEach((v) => { if (!uniq.has(v.name)) uniq.set(v.name, v); });
    return [...uniq.values()];
  }
  function fillSelect(sel, voices, savedName) {
    sel.innerHTML = '';
    voices.forEach((v) => {
      const o = document.createElement('option');
      o.value = v.name;
      const isTh = /^th/i.test(v.lang);
      o.textContent = (isTh ? '🇹🇭 ' : '') + v.name + ' (' + v.lang + ')';
      sel.appendChild(o);
    });
    if (savedName && voices.some((v) => v.name === savedName)) sel.value = savedName;
  }
  function refreshVoices() {
    const list = allVoices();
    if (!list.length) return;
    const th = list.filter((v) => /^th/i.test(v.lang));
    const en = list.filter((v) => /^en/i.test(v.lang));
    const rest = list.filter((v) => !/^th/i.test(v.lang) && !/^en/i.test(v.lang));
    fillSelect(el.selTh, th.concat(en, rest), state._savedTh);
    fillSelect(el.selEn, en.concat(th), state._savedEn);
    state.voiceTh = byName(el.selTh) || th[0] || null;
    state.voiceEn = byName(el.selEn) || en[0] || null;
    updateHint(th.length > 0);
    if (state.voiceTh) el.selTh.value = state.voiceTh.name;
    if (state.voiceEn) el.selEn.value = state.voiceEn.name;
  }
  function byName(sel) { return allVoices().find((v) => v.name === sel.value) || null; }
  function updateHint(hasThai) {
    el.hint.textContent = hasThai
      ? ''
      : '⚠️ ไม่พบเสียงภาษาไทยในเครื่อง — Chrome/Edge บน Windows และ Android มักมีให้ (ติดตั้งภาษาไทยในระบบก่อนได้)';
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

  /* ---------- หั่นข้อความเป็นท่อน ๆ สำหรับอ่าน ---------- */
  function chunkText(text) {
    const parts = text.split(/\n+/).flatMap((para) => {
      const sents = para.split(/(?<=[\.!?;:ๆ])\s+/);
      const out = [];
      for (let s of sents) {
        s = s.trim();
        if (!s) continue;
        if (s.length <= 200) { out.push(s); continue; }
        /* ท่อนยาวเกิน: หั่นตรงช่องว่างใกล้ ๆ 180 ตัวอักษร */
        let rest = s;
        while (rest.length > 200) {
          let cut = rest.lastIndexOf(' ', 180);
          if (cut < 60) cut = 180;
          out.push(rest.slice(0, cut).trim());
          rest = rest.slice(cut).trim();
        }
        if (rest) out.push(rest);
      }
      return out;
    });
    /* รวมท่อนสั้น ๆ ที่ติดกันให้อ่านต่อเนื่อง */
    const merged = [];
    for (const p of parts) {
      if (merged.length && (merged[merged.length - 1] + ' ' + p).length <= 200) {
        merged[merged.length - 1] += ' ' + p;
      } else merged.push(p);
    }
    return merged.filter(Boolean).map((t) => ({ text: t, thai: THAI_RE.test(t) }));
  }

  /* ---------- เครื่องยนต์อ่าน ---------- */
  function startRead(target, label) {
    const text = cleanText(target);
    if (!text) { setStatus('ไม่พบข้อความให้อ่าน'); return; }
    speechSynthesis.cancel();
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
    setStatus('กำลังอ่าน: ' + label);
    el.pauseBtn.textContent = '⏸ พัก';
    speakChunk(0, state.epoch);
  }
  function speakChunk(i, epoch) {
    if (state.stopped || epoch !== state.epoch) return;
    if (i >= state.chunks.length) { finish(); return; }
    state.idx = i;
    const c = state.chunks[i];
    const u = new SpeechSynthesisUtterance(c.text);
    const v = c.thai ? state.voiceTh : state.voiceEn;
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
  function stopAll() {
    state.epoch += 1;
    state.stopped = true; state.playing = false; state.paused = false;
    speechSynthesis.cancel();
    clearReading();
    setStatus('หยุดแล้ว');
    el.pauseBtn.textContent = '⏸ พัก';
  }
  function togglePause() {
    if (!state.playing) return;
    if (state.paused) { speechSynthesis.resume(); state.paused = false; el.pauseBtn.textContent = '⏸ พัก'; setStatus('กำลังอ่าน: ' + state.label); }
    else { speechSynthesis.pause(); state.paused = true; el.pauseBtn.textContent = '▶ เล่นต่อ'; setStatus('พักการอ่านอยู่'); }
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
      const name = (box.querySelector('.box-title') || box).textContent.replace(EMOJI_RE, '').trim().slice(0, 50);
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
          <label>เสียงไทย <select class="tts-vth"></select></label>
          <label>เสียงอังกฤษ <select class="tts-ven"></select></label>
        </div>
        <div class="tts-row">
          <label>ความเร็ว
            <select class="tts-rate">
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
    el.selTh.addEventListener('change', () => { state.voiceTh = byName(el.selTh); savePrefs(); });
    el.selEn.addEventListener('change', () => { state.voiceEn = byName(el.selEn); savePrefs(); });
  }

  /* ---------- เริ่มทำงาน ---------- */
  loadPrefs();
  buildBar();
  injectButtons();
  refreshVoices();
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
  window.addEventListener('beforeunload', () => speechSynthesis.cancel());
})();
