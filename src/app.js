(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ================= storage =================
  const Store = {
    data: { cal: null, prog: {}, muted: false, numbers: false, level: 'normal' },
    load() { try { const d = JSON.parse(localStorage.getItem('bulles-v1') || 'null'); if (d) Object.assign(this.data, d); } catch (e) {} },
    save() { try { localStorage.setItem('bulles-v1', JSON.stringify(this.data)); } catch (e) {} },
  };
  Store.load();
  DSP.setStrictness(Store.data.level);

  // ================= audio context + sound effects =================
  let ctx = null;
  function audioCtx() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; ctx = new AC(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const Sfx = {
    tone(freq, dur, type = 'sine', vol = 0.15, slideTo = null, delay = 0) {
      if (Store.data.muted || Mic.recording) return; // never play while listening
      try {
        const c = audioCtx(), t = c.currentTime + delay;
        const o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(c.destination);
        o.start(t); o.stop(t + dur + 0.03);
      } catch (e) {}
    },
    pop() { this.tone(450 + Math.random() * 350, 0.09, 'sine', 0.2, 1300 + Math.random() * 600); },
    tap() { this.tone(760, 0.05, 'triangle', 0.08); },
    good() { [660, 880, 1320].forEach((f, i) => this.tone(f, 0.2, 'sine', 0.13, null, i * 0.08)); },
    great() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.24, 'triangle', 0.12, null, i * 0.07)); },
    meh() { [520, 470].forEach((f, i) => this.tone(f, 0.16, 'sine', 0.1, null, i * 0.1)); },
    bad() { this.tone(330, 0.28, 'triangle', 0.12, 210); },
    ready() { this.tone(880, 0.07, 'sine', 0.09); },
  };

  // ================= microphone =================
  const Mic = {
    stream: null, src: null, proc: null, sink: null, recording: false, buf: [], fs: 48000, _stop: null,
    async ensure() {
      const c = audioCtx();
      if (this.stream && this.stream.active) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nomic');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
      this.src = c.createMediaStreamSource(this.stream);
      this.proc = c.createScriptProcessor(2048, 1, 1);
      this.sink = c.createGain(); this.sink.gain.value = 0;
      this.src.connect(this.proc); this.proc.connect(this.sink); this.sink.connect(c.destination);
      this.fs = c.sampleRate;
      this.proc.onaudioprocess = (e) => {
        if (!this.recording) return;
        const d = new Float32Array(e.inputBuffer.getChannelData(0));
        this.buf.push(d);
        if (this._onChunk) this._onChunk(d);
      };
    },
    release() {
      try { if (this.stream) this.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      try { this.src && this.src.disconnect(); this.proc && this.proc.disconnect(); } catch (e) {}
      this.stream = null;
    },
    stopNow() { if (this._stop) this._stop(); },
    /** Record until the speaker stops (or maxSec). onLive gets {rms, level, F1, F2, F3, voicing, speaking}. */
    record({ maxSec = 3, minSec = 0.6, silenceStop = 0.65, onLive = null } = {}) {
      return new Promise((resolve) => {
        this.buf = [];
        this.recording = true;
        const fs = this.fs;
        let elapsed = 0, noise = Infinity, speech = false, silentFor = 0, tail = new Float32Array(0), lastLive = 0;
        const finish = () => {
          if (!this.recording) return;
          this.recording = false; this._onChunk = null; this._stop = null;
          const n = this.buf.reduce((s, b) => s + b.length, 0);
          const out = new Float32Array(n);
          let k = 0;
          for (const b of this.buf) { out.set(b, k); k += b.length; }
          resolve({ samples: out, fs, speech });
        };
        this._stop = finish;
        this._onChunk = (d) => {
          const dur = d.length / fs;
          elapsed += dur;
          let s = 0;
          for (let i = 0; i < d.length; i++) s += d[i] * d[i];
          const rms = Math.sqrt(s / d.length);
          noise = Math.min(noise, Math.max(rms, 1e-5));
          const thr = Math.max(noise * 3.5, 0.003);
          const loud = rms > thr;
          if (loud) { speech = true; silentFor = 0; } else if (speech) silentFor += dur;
          // live analysis on the most recent ~45 ms
          const t2 = new Float32Array(Math.min(tail.length + d.length, Math.round(fs * 0.06)));
          const merged = new Float32Array(tail.length + d.length); merged.set(tail); merged.set(d, tail.length);
          t2.set(merged.subarray(merged.length - t2.length)); tail = t2;
          if (onLive) {
            let f = null;
            if (loud && elapsed - lastLive > 0.03) { try { f = DSP.liveFrame(tail, fs); } catch (e) {} lastLive = elapsed; }
            const level = Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-9) + 60) / 50));
            onLive({ rms, level, speaking: loud, ...(f || {}) });
          }
          if (elapsed >= maxSec || (speech && silentFor >= silenceStop && elapsed >= minSec)) finish();
        };
      });
    },
  };

  function playSamples(samples, fs) {
    try {
      const c = audioCtx();
      const b = c.createBuffer(1, samples.length, fs);
      b.copyToChannel ? b.copyToChannel(samples, 0) : b.getChannelData(0).set(samples);
      const s = c.createBufferSource(); s.buffer = b;
      const g = c.createGain(); g.gain.value = 1.4;
      s.connect(g); g.connect(c.destination); s.start();
    } catch (e) {}
  }

  // ================= French voice (text to speech) =================
  let frVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    const fr = vs.filter((v) => /^fr/i.test(v.lang));
    frVoice = fr.find((v) => /fr[-_]FR/i.test(v.lang) && /google|am[ée]lie|thomas|audrey|aur[ée]lie|marie|denise|julie|daniel/i.test(v.name)) || fr.find((v) => /fr[-_]FR/i.test(v.lang)) || fr[0] || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text, slow = false) {
    if (!('speechSynthesis' in window)) { toast('This browser can’t speak French aloud.'); return; }
    if (!frVoice) pickVoice();
    if (!frVoice) toast('No French voice found on this device — the model may sound off.');
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR'; if (frVoice) u.voice = frVoice;
    u.rate = slow ? 0.55 : 0.85;
    speechSynthesis.speak(u);
  }

  // ================= speech recognition (sentences) =================
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function recognize() {
    return new Promise((resolve) => {
      let done = false;
      const r = new SR();
      r.lang = 'fr-FR'; r.interimResults = false; r.maxAlternatives = 5; r.continuous = false;
      const end = (v) => { if (!done) { done = true; resolve(v); } };
      r.onresult = (e) => end({ ok: true, alts: Array.from(e.results[0]).map((a) => a.transcript) });
      r.onerror = (e) => end({ ok: false, error: e.error });
      r.onend = () => end({ ok: false, error: 'no-speech' });
      try { r.start(); } catch (e) { end({ ok: false, error: 'start' }); }
      setTimeout(() => { try { r.stop(); } catch (e) {} }, 8000);
    });
  }
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`-]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  function compareSentence(expected, alts) {
    const exp = norm(expected);
    let best = null;
    for (const alt of alts) {
      const got = norm(alt);
      // LCS alignment
      const m = exp.length, n = got.length, L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
      for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = exp[i] === got[j] ? 1 + L[i + 1][j + 1] : Math.max(L[i + 1][j], L[i][j + 1]);
      const ok = new Array(m).fill(false);
      let i = 0, j = 0;
      while (i < m && j < n) { if (exp[i] === got[j]) { ok[i] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
      const score = ok.filter(Boolean).length / m;
      if (!best || score > best.score) best = { score, ok, alt };
    }
    return best;
  }

  // ================= feedback text =================
  const VNAME = { i: 'I', y: 'U', u: 'OU', I: 'English “ih”', Y: 'English “oo”', U: '“oo” (book)', e: 'É', E: 'È', a: 'A', eu: 'EU', o: 'O' };
  const HINT = { close: 'close your mouth a little more (jaw up)', open: 'open your mouth a bit more', back: 'pull your tongue further back', front: 'push your tongue more forward', round: 'round your lips more 😗', spread: 'spread your lips — no rounding 😁' };
  const GLIDE = { e: 'You slid into “ee”, like English “day”. Keep É <b>pure and steady</b> — no slide.', o: 'You slid into “oo”, like English “go”. Keep O <b>pure</b> — lips stay still.' };
  const FB = {
    y: {
      u: 'That was <b>OU</b> (like “food”). Keep the kiss, but push your tongue <b>forward</b>, like for I.',
      Y: 'Almost! Push your tongue a bit <b>more forward</b> — think “eee” inside the kiss.',
      U: 'Too relaxed. <b>Tighter kiss</b>, tongue high and forward.',
      i: 'That was <b>I</b>. Same tongue — now <b>round your lips</b> into a tiny kiss. 😗',
      I: 'That sounded like English “ih”. Tongue high like “eee”, then <b>pucker</b>.',
      e: 'Mouth a bit too open. Nearly close it — tongue high, tiny kiss.',
      a: 'Mouth too open. Close it almost all the way into a tiny kiss.',
      glide: 'You slid like English <b>“you”</b> (ee→oo). Hold <b>one steady sound</b> from start to end.',
    },
    i: {
      I: 'Too relaxed — that’s English “ih” (as in <i>sit</i>). <b>Big smile</b>, tongue high and tight: “eee”.',
      y: 'Your lips were rounded (that’s U). <b>Spread them</b> into a big smile. 😁',
      Y: 'Lips rounded and tongue back. Big smile, tongue forward and high.',
      u: 'That was <b>OU</b>. Smile wide and bring your tongue forward.',
      U: 'Smile wide, tongue forward and high.',
      e: 'A bit too open (sounds like “é”). Close a little, smile, tense.',
      a: 'Mouth too open. Close it into a smile: “eee”.',
    },
    u: {
      y: 'That was the French <b>U</b>! For OU, pull your tongue <b>back</b> — like blowing out a candle. 🕯️',
      Y: 'Too far forward (English “oo” drifts forward). Pull the tongue <b>back</b>, round your lips tight.',
      i: 'That was <b>I</b>. Round your lips and pull your tongue back: “oo”.',
      I: 'Round your lips and pull the tongue back.',
      U: 'Too open — like “book”. <b>Tighter, rounder</b> lips.',
      e: 'Round your lips and pull your tongue back.',
      a: 'Mouth too open. Round your lips tightly.',
    },
  };
  const RFB = {
    french: 'Beautiful throat R! 🦁',
    english: 'That was an <b>English R</b> (tongue curled up). Keep the tongue tip <b>down</b> behind your bottom teeth and gargle softly at the back.',
    rolled: 'That was a <b>rolled R</b> (tongue tip, like Spanish). The French R is in the <b>throat</b> — tongue tip stays down.',
    weak: 'I couldn’t hear a throat R. Make it <b>stronger</b> — a soft gargle, like the end of Scottish “loch”.',
    silent: 'I didn’t hear anything — try a bit louder or closer to the mic.',
  };
  const RNAME = { french: 'French R', english: 'English R', rolled: 'Rolled R', weak: 'Too soft', silent: '—' };
  const PRAISE = ['Parfait ! 🎉', 'Bravo ! ✨', 'Super ! 🌟', 'Magnifique ! 💜', 'Génial ! 🫧', 'Trop bien ! 🙌'];
  const MID = ['Presque ! 🤏', 'So close!', 'Getting there! 💪'];
  const LOW = ['Not yet — try again 💜', 'Let’s fix it 🔧', 'Again! You’ve got this'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // ================= evaluation =================
  const cal = () => Store.data.cal;
  function vowelPart(target, got, score, glide, syl, hints) {
    const ok = score >= 70;
    let msg = '';
    if (!ok) {
      if (glide) msg = target === 'y' ? FB.y.glide : GLIDE[target] || 'Keep the sound steady — no slide.';
      else if (!got) msg = 'I couldn’t catch that vowel — try again, a bit louder.';
      else if (got === target) msg = `Close, but not quite a native <b>${VNAME[target]}</b> yet.`;
      else if (FB[target] && FB[target][got]) msg = FB[target][got];
      else msg = `That sounded closer to <b>${VNAME[got] || got}</b>.`;
      if (!glide && got && !(FB[target] && FB[target][got])) {
        const h = (hints || []).slice();
        const R = DSP.ROUNDED;
        if (R[target] && !R[got]) h.unshift('round');
        if (!R[target] && R[got]) h.unshift('spread');
        if (h.length) msg += ' Try to ' + h.slice(0, 2).map((x) => HINT[x]).join(', and ') + '.';
      }
    }
    return { type: 'vowel', target, got, score, ok, msg, syl };
  }
  function evalWord(it, rec) {
    const A = DSP.analyze(rec.samples, rec.fs);
    const parts = [];
    const syls = it.syl || [it.w];
    let dbg = { nuclei: DSP.nuclei(A).map((n) => [n.F1, n.F2, n.F3].map(Math.round)) };
    if (it.v) {
      const ev = DSP.evalVowels(A, it.v, cal());
      dbg.vowels = ev.syllables.map((s) => ({ t: s.target, g: s.got, sc: s.score, dist: s.dist, f: s.f && [s.f.F1, s.f.F2, s.f.F3].map(Math.round), glide: s.glide }));
      ev.syllables.forEach((s, k) => {
        const syl = syls[k] || syls[syls.length - 1];
        if (s.target === '*') parts.push({ type: 'skip', syl });
        else parts.push(vowelPart(s.target, s.got, s.score, s.glide, syl, s.hints));
      });
    } else syls.forEach((syl) => parts.push({ type: 'skip', syl }));
    if (it.r) {
      const r = DSP.evalR(A, rec.samples, cal());
      dbg.r = r;
      parts.push({ type: 'r', kind: r.kind, score: r.score, ok: r.score >= 70, msg: r.score >= 70 ? '' : RFB[r.kind] });
    }
    return finalize(parts, rec, dbg);
  }
  function evalSustainItem(it, rec) {
    const A = DSP.analyze(rec.samples, rec.fs);
    const parts = [];
    let track = null, dbg = {};
    if (it.kind === 'rsustain') {
      const r = DSP.evalRSustained(A, rec.samples, cal());
      dbg.r = r;
      parts.push({ type: 'r', kind: r.kind, score: r.score, ok: r.score >= 70, msg: r.score >= 70 ? '' : RFB[r.kind] });
    } else if (it.kind === 'glide') {
      const ev = DSP.evalSustained(A, 'iy', cal());
      dbg.ev = ev.parts;
      if (!ev.heard) parts.push({ type: 'vowel', target: 'y', got: null, score: 0, ok: false, msg: 'I couldn’t hear a long enough sound. Hold it for about 2 seconds.', syl: 'i → u' });
      else {
        track = ev.track;
        ev.parts.forEach((p, k) => parts.push(vowelPart(p.target, p.got, p.score, false, k ? 'uuu' : 'iii', p.hints)));
      }
    } else {
      const ev = DSP.evalSustained(A, it.target, cal());
      dbg.ev = { score: ev.score, share: ev.share, got: ev.got, f: ev.f };
      if (!ev.heard) parts.push({ type: 'vowel', target: it.target, got: null, score: 0, ok: false, msg: 'I couldn’t hear a long enough sound. Hold it for about 2 seconds.', syl: it.say });
      else { track = ev.track; parts.push(vowelPart(it.target, ev.got, ev.score, false, it.say, ev.hints)); }
    }
    const res = finalize(parts, rec, dbg);
    res.track = track;
    return res;
  }
  function finalize(parts, rec, dbg) {
    const scored = parts.filter((p) => p.type !== 'skip');
    const score = scored.length ? Math.min(...scored.map((p) => p.score)) : 100;
    let peak = 0, clip = 0;
    for (let i = 0; i < rec.samples.length; i++) { const a = Math.abs(rec.samples[i]); if (a > peak) peak = a; if (a > 0.985) clip++; }
    const notes = [];
    if (clip > 40) notes.push('A little too loud — hold the phone a bit further away.');
    else if (peak < 0.02 && rec.speech) notes.push('Very quiet — come a bit closer to the mic.');
    const worst = scored.filter((p) => !p.ok).sort((a, b) => a.score - b.score)[0];
    return { score, parts, msg: worst ? worst.msg : '', notes, dbg, rec };
  }

  // ================= visuals: background bubbles + particles =================
  const COLORS = [['#ffd6f0', '#e9b8ff'], ['#d4ecff', '#b9c8ff'], ['#fff1c9', '#ffc9a8'], ['#d2fbef', '#a6e6ff'], ['#efe0ff', '#c5b4ff']];
  const bg = $('#bg');
  function spawnBubble(initial) {
    const b = document.createElement('div');
    b.className = 'bub';
    const size = 26 + Math.random() * 70;
    const [c1, c2] = COLORS[Math.floor(Math.random() * COLORS.length)];
    b.style.cssText = `width:${size}px;height:${size}px;left:${Math.random() * 96}%;--c1:${c1};--c2:${c2};animation-duration:${14 + Math.random() * 16}s;animation-delay:${initial ? -Math.random() * 25 : 0}s`;
    b.addEventListener('pointerdown', (e) => {
      if (b.classList.contains('pop')) return;
      b.classList.add('pop');
      Sfx.pop();
      burst(e.clientX, e.clientY, c2, 10);
      setTimeout(() => { b.remove(); spawnBubble(false); }, 260);
    });
    b.addEventListener('animationiteration', () => { b.style.left = Math.random() * 96 + '%'; });
    bg.appendChild(b);
  }
  for (let i = 0; i < 13; i++) spawnBubble(true);

  const fx = $('#fx'), fctx = fx.getContext('2d');
  let parts = [], fxRunning = false;
  function sizeFx() { const d = window.devicePixelRatio || 1; fx.width = innerWidth * d; fx.height = innerHeight * d; fctx.setTransform(d, 0, 0, d, 0, 0); }
  sizeFx(); addEventListener('resize', sizeFx);
  function burst(x, y, color, n = 16, kind = 'bubble') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 4.5;
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'confetti' ? 3 : 1), r: kind === 'confetti' ? 5 + Math.random() * 5 : 3 + Math.random() * 7, life: 1, color: Array.isArray(color) ? color[i % color.length] : color, kind, rot: Math.random() * 6 });
    }
    if (!fxRunning) { fxRunning = true; requestAnimationFrame(stepFx); }
  }
  function stepFx() {
    fctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.life > 0);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += p.kind === 'confetti' ? 0.18 : 0.05; p.vx *= 0.98; p.life -= p.kind === 'confetti' ? 0.008 : 0.022; p.rot += 0.15;
      fctx.globalAlpha = Math.max(0, p.life);
      if (p.kind === 'confetti') {
        fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.fillStyle = p.color; fctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); fctx.restore();
      } else {
        fctx.beginPath(); fctx.arc(p.x, p.y, p.r * (1.4 - p.life * 0.4), 0, Math.PI * 2);
        fctx.fillStyle = p.color + '66'; fctx.fill();
        fctx.lineWidth = 2; fctx.strokeStyle = p.color; fctx.stroke();
      }
    }
    fctx.globalAlpha = 1;
    if (parts.length) requestAnimationFrame(stepFx); else { fxRunning = false; fctx.clearRect(0, 0, innerWidth, innerHeight); }
  }
  function celebrate(el, big) {
    const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    burst(x, y, ['#8b6cff', '#ff7aa8', '#2ec4b6', '#ffb020'], big ? 26 : 16);
    if (big) setTimeout(() => { for (let i = 0; i < 5; i++) burst(Math.random() * innerWidth, -10, ['#8b6cff', '#ff7aa8', '#2ec4b6', '#ffb020', '#22c58b'], 22, 'confetti'); }, 150);
  }
  function wobble(el) { if (!el) return; el.classList.remove('wobble'); void el.offsetWidth; el.classList.add('wobble'); }

  let toastT = null;
  function toast(msg, ms = 3200) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.innerHTML = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms);
  }

  // ================= vowel map =================
  const ZONES = {
    i: { label: 'I', em: '😁', col: '#ff7aa8' }, e: { label: 'É', em: '🙂', col: '#ff9f43' }, E: { label: 'È', em: '😃', col: '#f7b733' },
    a: { label: 'A', em: '😮', col: '#e8505b' }, y: { label: 'U', em: '😗', col: '#8b6cff' }, eu: { label: 'EU', em: '😙', col: '#5c7cfa' },
    o: { label: 'O', em: '⭕', col: '#17a2b8' }, u: { label: 'OU', em: '🕯️', col: '#2ec4b6' },
  };
  function VowelMap(canvas, target, all) {
    const T = DSP.templates(cal());
    const d = window.devicePixelRatio || 1;
    const W = 400, H = all ? 260 : 190;
    canvas.width = W * d; canvas.height = H * d;
    const g = canvas.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    const f2max = T.i.F2 * 1.2, f2min = T.u.F2 * 0.72;
    const f1min = Math.min(T.i.F1, T.u.F1) * 0.62, f1max = all ? T.a.F1 * 1.25 : Math.max(T.i.F1, T.u.F1) * 1.9;
    const X = (f2) => 28 + ((Math.log(f2max) - Math.log(f2)) / (Math.log(f2max) - Math.log(f2min))) * (W - 56);
    const Y = (f1) => 30 + ((Math.log(f1) - Math.log(f1min)) / (Math.log(f1max) - Math.log(f1min))) * (H - 60);
    const R = ((W - 56) * DSP.PASS() * (all ? 0.75 : 0.85)) / (Math.log(f2max) - Math.log(f2min));
    const zones = (all ? DSP.FR_KEYS : ['i', 'y', 'u']).map((k) => ({ k, ...ZONES[k] }));
    let trail = [], shots = [], dot = null, t0 = performance.now(), raf = 0, alive = true;
    function draw() {
      if (!alive) return;
      const t = (performance.now() - t0) / 1000;
      g.clearRect(0, 0, W, H);
      g.font = '600 12px Fredoka, system-ui'; g.fillStyle = '#b3a9cf'; g.textAlign = 'left';
      g.fillText('◀ tongue forward', 10, H - 10); g.textAlign = 'right'; g.fillText('tongue back ▶', W - 10, H - 10);
      for (const z of zones) {
        const x = X(T[z.k].F2), y = Y(T[z.k].F1);
        const isT = target && target.includes(z.k);
        const pulse = isT ? 1 + 0.06 * Math.sin(t * 4) : 1;
        const rr = R * pulse;
        const grd = g.createRadialGradient(x - rr * 0.3, y - rr * 0.35, rr * 0.1, x, y, rr);
        grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, z.col + (isT ? '88' : '33'));
        g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fillStyle = grd; g.fill();
        g.lineWidth = isT ? 3 : 1.5; g.strokeStyle = z.col + (isT ? 'ff' : '66'); g.stroke();
        if (!all) { g.textAlign = 'center'; g.font = '14px system-ui'; g.fillStyle = z.col; g.fillText(z.em, x, y - rr - 6); }
      }
      // past shots
      for (const s of shots) {
        const x = X(s.F2), y = Y(s.F1);
        g.beginPath(); g.arc(x, y, 5.5, 0, Math.PI * 2); g.fillStyle = s.ok ? '#22c58b' : '#ff5d7a'; g.fill();
        g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
      }
      for (const z of zones) {
        const isT = target && target.includes(z.k);
        g.textAlign = 'center'; g.font = `700 ${isT ? 20 : 16}px Fredoka, system-ui`;
        g.lineWidth = 4; g.strokeStyle = '#ffffffcc'; g.strokeText(z.label, X(T[z.k].F2), Y(T[z.k].F1) + 6);
        g.fillStyle = z.col; g.fillText(z.label, X(T[z.k].F2), Y(T[z.k].F1) + 6);
      }
      // trail
      trail = trail.filter((p) => t - p.t < 1.2);
      for (const p of trail) {
        const a = 1 - (t - p.t) / 1.2;
        g.beginPath(); g.arc(X(p.F2), Y(p.F1), 4 + 3 * a, 0, Math.PI * 2); g.fillStyle = `rgba(45,35,70,${0.25 * a})`; g.fill();
      }
      if (dot && t - dot.t < 0.4) {
        g.beginPath(); g.arc(X(dot.F2), Y(dot.F1), 11, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
        g.lineWidth = 4; g.strokeStyle = '#2d2346'; g.stroke();
      }
      raf = requestAnimationFrame(draw);
    }
    draw();
    let ema = null;
    return {
      live(f) {
        if (!f || isNaN(f.F1) || isNaN(f.F2) || !(f.voicing > 0.6)) return;
        const F1 = Math.min(f1max, Math.max(f1min, f.F1)), F2 = Math.min(f2max, Math.max(f2min, f.F2));
        ema = ema ? { F1: ema.F1 * 0.6 + F1 * 0.4, F2: ema.F2 * 0.6 + F2 * 0.4 } : { F1, F2 };
        const t = (performance.now() - t0) / 1000;
        dot = { ...ema, t }; trail.push({ ...ema, t });
      },
      reset() { ema = null; trail = []; dot = null; },
      shot(F1, F2, ok) { if (!isNaN(F1) && !isNaN(F2)) shots.push({ F1: Math.min(f1max, Math.max(f1min, F1)), F2: Math.min(f2max, Math.max(f2min, F2)), ok }); if (shots.length > 6) shots.shift(); },
      destroy() { alive = false; cancelAnimationFrame(raf); },
    };
  }

  // ================= mouth illustration =================
  function faceSVG(kind) {
    // mouth shapes: wide smile (i), small round kiss (y), round forward (u), slightly open + throat (r)
    const anim = {
      iy: '<animate attributeName="rx" values="30;30;10;10;30" keyTimes="0;.3;.5;.85;1" dur="3.4s" repeatCount="indefinite"/><animate attributeName="ry" values="7;7;11;11;7" keyTimes="0;.3;.5;.85;1" dur="3.4s" repeatCount="indefinite"/>',
      i: '<animate attributeName="rx" values="30;33;30" dur="1.6s" repeatCount="indefinite"/>',
      mix: '<animate attributeName="rx" values="30;30;10;10;13;13;30" keyTimes="0;.2;.3;.55;.65;.9;1" dur="4.5s" repeatCount="indefinite"/><animate attributeName="ry" values="7;7;11;11;14;14;7" keyTimes="0;.2;.3;.55;.65;.9;1" dur="4.5s" repeatCount="indefinite"/>',
      r: '<animate attributeName="ry" values="10;12;10" dur=".5s" repeatCount="indefinite"/>',
    }[kind] || '';
    const rx = { iy: 30, i: 30, mix: 30, r: 20, e: 27, E: 25, a: 21, y: 10, eu: 13, o: 13, u: 9 }[kind] || 26, ry = { iy: 7, i: 7, mix: 7, r: 10, e: 9, E: 13, a: 21, y: 10, eu: 12, o: 15, u: 11 }[kind] || 9;
    const throat = kind === 'r' ? `<g stroke="#ff9f43" stroke-width="3" fill="none" stroke-linecap="round">
        <path d="M70 150 q15 -8 30 0"><animate attributeName="opacity" values="1;.2;1" dur=".45s" repeatCount="indefinite"/></path>
        <path d="M64 160 q21 -10 42 0"><animate attributeName="opacity" values=".2;1;.2" dur=".45s" repeatCount="indefinite"/></path></g>
        <path d="M70 117 q15 6 30 0" stroke="#ff7aa8" stroke-width="4" fill="none" stroke-linecap="round"/>` : '';
    return `<svg class="face" viewBox="0 0 170 170" aria-hidden="true">
      <defs><radialGradient id="fg" cx="35%" cy="30%"><stop offset="0" stop-color="#fff3c4"/><stop offset="1" stop-color="#ffd166"/></radialGradient></defs>
      <circle cx="85" cy="80" r="66" fill="url(#fg)" stroke="#f5b942" stroke-width="3"/>
      <circle cx="62" cy="66" r="7" fill="#2d2346"/><circle cx="108" cy="66" r="7" fill="#2d2346"/>
      <circle cx="64" cy="63" r="2.2" fill="#fff"/><circle cx="110" cy="63" r="2.2" fill="#fff"/>
      <ellipse cx="50" cy="90" rx="10" ry="6" fill="#ff9fb8" opacity=".6"/><ellipse cx="120" cy="90" rx="10" ry="6" fill="#ff9fb8" opacity=".6"/>
      <ellipse cx="85" cy="104" rx="${rx}" ry="${ry}" fill="#7a2948" stroke="#c2185b" stroke-width="3">${anim}</ellipse>
      ${throat}
    </svg>`;
  }

  // ================= screens =================
  let cleanup = [];
  function mount(html) {
    cleanup.forEach((f) => { try { f(); } catch (e) {} }); cleanup = [];
    Mic.stopNow();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    app.innerHTML = html;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  function lessonStars(L) {
    const p = Store.data.prog[L.id];
    if (!p || !p.best) return 0;
    const keys = []; L.steps.forEach((s, si) => s.items.forEach((_, ii) => keys.push(si + ':' + ii)));
    const avg = keys.reduce((s, k) => s + (p.best[k] || 0), 0) / keys.length;
    return avg >= 85 ? 3 : avg >= 70 ? 2 : avg >= 35 ? 1 : 0;
  }

  function micError(e) {
    const insecure = !window.isSecureContext;
    toast(insecure ? 'The microphone needs a secure (https) page. Put the app online (e.g. Netlify) and open it from there.' : 'I can’t use the microphone. Please allow mic access in your browser settings and try again.', 6000);
  }

  // ---------- home ----------
  function Home() {
    const c = cal();
    mount(`
      <div class="top"><div class="logo">Bulles<span>🫧</span></div>
        <button class="iconbtn" id="mute" title="Sound effects">${Store.data.muted ? '🔇' : '🔊'}</button></div>
      <p class="tag">Your little French pronunciation coach</p>
      <div class="card calib">
        <div class="em">${c ? '🎙️' : '👋'}</div>
        <div style="flex:1"><h3>${c ? 'Voice tuned' : 'First, let me learn your voice'}</h3>
          <p>${c ? 'Ready to go. Redo it if you change device or mic.' : 'Three quick sounds, 20 seconds. It makes the feedback much more accurate.'}</p></div>
        <button class="pill ${c ? 'ghost small' : ''}" id="cal">${c ? 'Redo' : 'Start'}</button>
      </div>
      <div class="lessons">
        ${LESSONS.map((L) => `<button class="lesson" data-id="${L.id}" style="--col:${L.color};--soft:${L.soft}">
          <div class="em">${L.emoji}</div><div class="t">${L.title}</div><div class="s">${L.sub}</div>
          <div class="stars" style="color:${L.color}">${starStr(lessonStars(L))}</div></button>`).join('')}
      </div>
      <h3 class="sec">🏋️ Word gym <small>practise words by vowel</small></h3>
      <div class="gymgrid">
        ${GYM.map((G) => `<button class="gv" data-gid="${G.id}" style="--col:${G.color};--soft:${G.soft}"><div class="l">${G.letter}</div><div class="x">${G.sub}</div><div class="st">${starStr(lessonStars(G))}</div></button>`).join('')}
      </div>
      <div class="foot">
        <div class="seg" id="lvl">${['easy', 'normal', 'strict'].map((l) => `<button data-l="${l}" class="${Store.data.level === l ? 'on' : ''}">${{ easy: '🙂 Easy', normal: '🎯 Normal', strict: '🧐 Strict' }[l]}</button>`).join('')}</div>
        <label class="toggle"><input type="checkbox" id="nums" ${Store.data.numbers ? 'checked' : ''}> Show the numbers (coach view)</label>
        <button class="toggle" id="reset">↺ Reset progress</button>
      </div>`);
    $('#mute').onclick = () => { Store.data.muted = !Store.data.muted; Store.save(); $('#mute').textContent = Store.data.muted ? '🔇' : '🔊'; Sfx.tap(); };
    $('#cal').onclick = () => { Sfx.tap(); Calibrate(); };
    $('#nums').onchange = (e) => { Store.data.numbers = e.target.checked; Store.save(); };
    $('#reset').onclick = () => {
      const b = $('#reset');
      if (b.dataset.sure) { Store.data.prog = {}; Store.save(); Home(); toast('Progress reset.'); }
      else { b.dataset.sure = 1; b.textContent = 'Tap again to confirm'; }
    };
    app.querySelectorAll('#lvl button').forEach((b) => b.onclick = () => {
      Store.data.level = b.dataset.l; Store.save(); DSP.setStrictness(b.dataset.l); Sfx.tap();
      app.querySelectorAll('#lvl button').forEach((x) => x.classList.toggle('on', x === b));
      toast({ easy: 'Easy: friendlier grading for beginners.', normal: 'Normal: close to a native sound.', strict: 'Strict: native-level precision.' }[b.dataset.l]);
    });
    app.querySelectorAll('.gv').forEach((b) => b.onclick = () => {
      Sfx.pop(); celebrate(b);
      const G = GYM.find((x) => x.id === b.dataset.gid);
      if (!cal()) CalNudge(G); else Lesson(G);
    });
    app.querySelectorAll('.lesson').forEach((b) => b.onclick = () => {
      Sfx.pop(); celebrate(b);
      const L = LESSONS.find((x) => x.id === b.dataset.id);
      if (!cal()) CalNudge(L); else Lesson(L);
    });
  }

  function CalNudge(L) {
    mount(`<div class="card center"><div class="big-emoji">🎙️</div>
      <h2>Quick voice tune-up?</h2><p class="muted">Every voice is different. 20 seconds of “iii, aaa, ouuu” lets me judge <b>your</b> vowels properly.</p>
      <div class="actions"><button class="pill" id="go">Tune my voice</button><button class="pill ghost" id="skip">Skip for now</button></div></div>`);
    $('#go').onclick = () => Calibrate(L);
    $('#skip').onclick = () => Lesson(L);
  }

  // ---------- calibration ----------
  function Calibrate(thenLesson) {
    const steps = [
      { k: 'a', label: 'a', say: 'aaaa', how: 'mouth wide open, like “<b>ah</b>” at the doctor 😮', model: 'a' },
      { k: 'i', label: 'i', say: 'iiii', how: 'like in “s<b>ee</b>” — big tight smile 😁', model: 'i' },
      { k: 'u', label: 'ou', say: 'ouuu', how: 'round lips like blowing out a candle 🕯️ — tongue <b>back</b>', model: 'ou' },
    ];
    const res = {};
    const fails = [0, 0, 0];
    let idx = 0;
    mount(`<div class="lhead"><button class="iconbtn" id="back">←</button><h2>Voice tune-up</h2></div>
      <div class="card center" id="cc">
        <div class="calsteps">${steps.map((s, i) => `<div class="cs" id="cs${i}">${s.label}</div>`).join('')}</div>
        <div id="calmsg"></div>
        <div class="word" id="csay"></div><div class="en" id="chow"></div>
        <div class="models"><button class="pill ghost small" id="cmodel">🔊 Hear it</button></div>
        <div class="micwrap"><button class="mic" id="mic"><span class="ring"></span><span class="ring"></span>🎤</button>
          <div class="level"><i id="lvl"></i></div><div class="miclabel" id="ml">Tap, then hold the sound for 2 seconds</div></div>
      </div>`);
    $('#back').onclick = () => Home();
    const show = (failIdx) => {
      steps.forEach((s, i) => { $('#cs' + i).className = 'cs' + (i === failIdx ? ' fail' : i < idx ? ' done' : i === idx ? ' cur' : ''); $('#cs' + i).textContent = i === failIdx ? '✗' : i < idx ? '✓' : s.label; });
      $('#csay').textContent = steps[idx].say; $('#chow').innerHTML = steps[idx].how;
    };
    const failCard = (msg) => {
      fails[idx]++;
      $('#calmsg').innerHTML = `<div class="failcard"><div class="fx">✗</div><div><b>Not quite — let’s redo “${steps[idx].say}”</b><p>${msg}</p>${fails[idx] >= 3 ? '<p class="small">Tip: tap 🔊 Hear it and copy the model. Exaggerate it!</p>' : ''}</div></div>`;
      show(idx);
      Sfx.bad(); wobble($('#cc'));
      $('#ml').textContent = 'Tap 🎤 and try again';
      setTimeout(() => { const c = $('#cs' + idx); if (c) { c.className = 'cs cur'; c.textContent = steps[idx].label; } }, 1800);
    };
    show();
    $('#cmodel').onclick = () => speak(steps[idx].model);
    $('#mic').onclick = async () => {
      if (Mic.recording) { Mic.stopNow(); return; }
      try { await Mic.ensure(); } catch (e) { micError(e); return; }
      Sfx.ready(); await sleep(160);
      $('#calmsg').innerHTML = '';
      $('#mic').classList.add('rec'); $('#ml').textContent = 'Listening… hold it';
      const rec = await Mic.record({ maxSec: 3, minSec: 1.4, silenceStop: 0.5, onLive: (f) => { const l = $('#lvl'); if (l) l.style.width = f.level * 100 + '%'; } });
      const m = $('#mic'); if (!m) return;
      m.classList.remove('rec'); $('#lvl').style.width = '0';
      const v = DSP.calibrationVowel(DSP.analyze(rec.samples, rec.fs));
      const chk = DSP.checkCalVowel(steps[idx].k, v, res);
      if (!chk.ok) return failCard(chk.msg);
      res[steps[idx].k] = v;
      Sfx.good(); celebrate($('#cs' + idx));
      $('#calmsg').innerHTML = `<div class="okcard">✓ Great “${steps[idx].say}”!</div>`;
      idx++;
      if (idx < steps.length) { show(); $('#ml').textContent = 'Next sound 👉 tap and hold'; return; }
      Store.data.cal = res; Store.save();
      Sfx.great(); celebrate(null, true);
      $('#cc').innerHTML = `<div class="big-emoji">🎉</div><h2>Voice tuned!</h2>
        <p class="muted">Here’s your personal vowel map. The bubbles are where a <b>native</b> I, U and OU land for your voice.</p>
        <div class="viz"><canvas class="map" id="map"></canvas></div>
        ${Store.data.numbers ? `<div class="numbers">${JSON.stringify(res, (k, v) => typeof v === 'number' ? Math.round(v) : v)}</div>` : ''}
        <div class="actions"><button class="pill" id="done">${thenLesson ? 'Start the lesson →' : 'Done'}</button></div>`;
      const vm = VowelMap($('#map'), ['i', 'y', 'u']); cleanup.push(vm.destroy);
      $('#done').onclick = () => (thenLesson ? Lesson(thenLesson) : Home());
    };
  }

  // ---------- lesson ----------
  function Lesson(L) {
    document.documentElement.style.setProperty('--accent', L.color);
    document.documentElement.style.setProperty('--soft', L.soft);
    const flat = [];
    L.steps.forEach((s, si) => s.items.forEach((it, ii) => flat.push({ s, si, ii, it, key: si + ':' + ii })));
    const prog = (Store.data.prog[L.id] = Store.data.prog[L.id] || { best: {} });
    const session = {};
    let pos = -1; // -1 = tip

    mount(`<div class="lhead"><button class="iconbtn" id="back">←</button><h2>${L.gym ? '🏋️' : L.emoji} ${L.title}</h2>
      <button class="iconbtn" id="mute">${Store.data.muted ? '🔇' : '🔊'}</button></div>
      <div class="prog"><i id="bar"></i></div><div id="stage"></div>`);
    $('#back').onclick = () => { resetAccent(); Home(); };
    $('#mute').onclick = () => { Store.data.muted = !Store.data.muted; Store.save(); $('#mute').textContent = Store.data.muted ? '🔇' : '🔊'; };
    const stage = $('#stage');
    const setBar = () => { $('#bar').style.width = Math.max(3, ((pos + 1) / (flat.length + 1)) * 100) + '%'; };

    function tip() {
      setBar();
      stage.innerHTML = `<div class="card tip">${faceSVG(L.tip.mouth)}<h2>${L.tip.title}</h2>
        <ul class="tiplines">${L.tip.lines.map((l, i) => `<li style="animation-delay:${0.25 + i * 0.45}s">${l}</li>`).join('')}</ul>
        <div class="actions"><button class="pill ghost" id="hear">🔊 Hear it</button><button class="pill" id="go">Let’s go! →</button></div></div>`;
      $('#hear').onclick = () => speak(L.tip.model, true);
      $('#go').onclick = () => { Sfx.pop(); next(); };
    }

    function next() {
      pos++;
      setBar();
      if (pos >= flat.length) return summary();
      const cur = flat[pos];
      if (cur.ii === 0) {
        // step intro bubble
        stage.innerHTML = `<div class="card center"><div class="steplabel">Step ${cur.si + 1} of ${L.steps.length}</div>
          <div class="big-emoji">${['🫧', '🐣', '🎯', '🌈', '🗣️'][cur.si % 5]}</div><h2 style="margin:6px 0 2px">${cur.s.title}</h2>
          <p class="muted">${cur.s.items.length} ${cur.s.items.length > 1 ? 'challenges' : 'challenge'}</p>
          <div class="actions"><button class="pill" id="go">Start</button></div></div>`;
        $('#go').onclick = () => { Sfx.pop(); item(cur); };
        Sfx.tap();
      } else item(cur);
    }

    function record(key, score) {
      prog.best[key] = Math.max(prog.best[key] || 0, score);
      session[key] = Math.max(session[key] || 0, score);
      Store.save();
    }

    function item(cur) {
      const it = cur.it;
      cleanup.forEach((f) => { try { f(); } catch (e) {} }); cleanup = [];
      const label = `<div class="steplabel">${cur.s.title} · ${cur.ii + 1}/${cur.s.items.length}</div>`;
      if (it.kind === 'sentence') return sentenceItem(cur, label);
      const isMulti = it.kind === 'pair' || it.kind === 'triple';
      const words = isMulti ? (it.kind === 'pair' ? [it.a, it.b] : it.words) : null;
      const needsMap = it.kind === 'sustain' || it.kind === 'glide' || (isMulti ? words.some((w) => w.v) : !!it.v);
      const needsR = it.kind === 'rsustain' || (isMulti ? words.some((w) => w.r) : !!it.r);
      const targets = it.kind === 'sustain' ? [it.target] : it.kind === 'glide' ? ['i', 'y'] : isMulti ? [] : (it.v || []).filter((v) => v !== '*');
      let wi = 0; // index inside multi
      const multiRes = [];
      let attempts = 0, last = null;

      const promptHTML = () => {
        if (isMulti) return `<div class="multi">${words.map((w, k) => `${k ? '<span class="arrow">›</span>' : ''}<div class="w ${k === wi ? 'cur' : k < wi ? 'done' : ''}" id="mw${k}">${w.w}<small>${w.en || ''}</small>${multiRes[k] ? `<span class="badge">${multiRes[k].score >= 70 ? '✅' : '❌'}</span>` : ''}</div>`).join('')}</div>
          <div class="hint">${wi < words.length ? `Say: <b>${words[wi].w}</b>` : ''}</div>`;
        const w = it.w || it.say;
        return `<div class="word ${w.length > 9 ? 'long' : ''}">${w}</div><div class="en">${it.en ? '“' + it.en + '”' : ''}</div>${it.hint ? `<div class="hint">${it.hint}</div>` : ''}`;
      };
      stage.innerHTML = `<div class="card" id="card">${label}
        <div class="prompt" id="prompt">${promptHTML()}</div>
        <div class="models"><button class="pill ghost small" id="m1">🔊 Hear it</button><button class="pill ghost small" id="m2">🐢 Slowly</button></div>
        ${needsMap ? '<div class="viz"><canvas class="map" id="map"></canvas><div class="vizcap">Your voice is the dark dot — aim for the glowing bubble ✨</div></div>' : ''}
        ${needsR && !needsMap ? `<div class="viz rmeter" id="rm">${['french', 'english', 'rolled', 'weak'].map((k) => `<div class="rtype" data-k="${k}"><b>${{ french: '🦁', english: '👅', rolled: '🌀', weak: '🤫' }[k]}</b>${RNAME[k]}</div>`).join('')}</div>` : ''}
        <div class="micwrap"><button class="mic" id="mic"><span class="ring"></span><span class="ring"></span>🎤</button>
          <div class="level"><i id="lvl"></i></div><div class="miclabel" id="ml">Tap the bubble and speak</div></div>
        <div class="result" id="res"></div></div>`;
      const vm = needsMap ? VowelMap($('#map'), isMulti ? (words[0].v || []).filter((v) => v !== '*') : targets, !!L.gym) : null;
      if (vm) cleanup.push(vm.destroy);
      const modelText = () => (isMulti ? words[wi] ? words[wi].w : words.map((w) => w.w).join(', ') : it.kind === 'rsustain' ? 'ra, ri, rou' : it.model || it.w);
      $('#m1').onclick = () => speak(modelText());
      $('#m2').onclick = () => speak(modelText(), true);
      const setMapTarget = () => {
        if (!vm || !isMulti) return;
        // rebuild map with the current word's target
        vm.destroy();
        const nv = VowelMap($('#map'), (words[wi] ? words[wi].v || [] : []).filter((v) => v !== '*'), !!L.gym);
        cleanup.push(nv.destroy);
        Object.assign(vm, nv);
      };

      $('#mic').onclick = async () => {
        if (Mic.recording) { Mic.stopNow(); return; }
        if ($('#mic').classList.contains('busy')) return;
        try { await Mic.ensure(); } catch (e) { micError(e); return; }
        if ('speechSynthesis' in window) speechSynthesis.cancel();
        Sfx.ready(); await sleep(170);
        if (isMulti && wi >= words.length) { wi = 0; multiRes.length = 0; $('#prompt').innerHTML = promptHTML(); setMapTarget(); }
        $('#res').innerHTML = '';
        $('#mic').classList.add('rec'); $('#ml').textContent = 'Listening… 👂';
        if (vm) vm.reset();
        const sustained = it.kind === 'sustain' || it.kind === 'glide' || it.kind === 'rsustain';
        const rec = await Mic.record({
          maxSec: sustained ? 3.5 : 2.6, minSec: sustained ? 1.2 : 0.5, silenceStop: sustained ? 0.5 : 0.6,
          onLive: (f) => { const l = $('#lvl'); if (l) l.style.width = f.level * 100 + '%'; if (vm) vm.live(f); },
        });
        const mic = $('#mic'); if (!mic) return;
        mic.classList.remove('rec'); mic.classList.add('busy'); $('#lvl').style.width = '0';
        $('#ml').textContent = 'Thinking… 🤔';
        await sleep(30);
        let r;
        try {
          if (sustained) r = evalSustainItem(it, rec);
          else r = evalWord(isMulti ? words[wi] : it, rec);
        } catch (e) { console.error(e); r = { score: 0, parts: [], msg: 'Oops, something went wrong analysing that. Try again.', notes: [], rec }; }
        mic.classList.remove('busy');
        last = r;
        if (!rec.speech) { r.score = 0; r.msg = RFB.silent; }
        // map shots
        if (vm) {
          if (r.track) r.track.filter((_, k) => k % 3 === 0).slice(-12).forEach((p) => vm.shot(p.F1, p.F2, r.score >= 70));
          else if (r.dbg && r.dbg.vowels) r.dbg.vowels.filter((v) => v.f && v.t !== '*').forEach((v) => vm.shot(v.f[0], v.f[1], v.sc >= 70));
        }
        if (isMulti) {
          multiRes[wi] = r;
          wi++;
          if (wi < words.length) {
            $('#prompt').innerHTML = promptHTML();
            setMapTarget();
            if (r.score >= 70) Sfx.good(); else Sfx.meh();
            $('#ml').innerHTML = r.score >= 70 ? `Nice! Now: <b>${words[wi].w}</b>` : `Hmm — keep going, now: <b>${words[wi].w}</b>`;
            return;
          }
          $('#prompt').innerHTML = promptHTML();
          const worst = multiRes.slice().sort((a, b) => a.score - b.score)[0];
          const total = Math.min(...multiRes.map((x) => x.score));
          r = { ...worst, score: total, multi: multiRes.slice(), words };
        }
        attempts++;
        showResult(r);
      };

      function showResult(r) {
        record(cur.key, r.score);
        const good = r.score >= 70;
        const col = r.score >= 85 ? 'var(--good)' : r.score >= 70 ? '#4cc38a' : r.score >= 45 ? 'var(--mid)' : 'var(--bad)';
        const chips = [];
        const addChips = (res, prefix) => {
          for (const p of res.parts || []) {
            if (p.type === 'skip') chips.push(`<div class="chip na">${prefix || ''}${p.syl}<small>·</small></div>`);
            else if (p.type === 'vowel') chips.push(`<div class="chip ${p.ok ? 'ok' : 'no'}">${prefix || ''}${p.syl} ${p.ok ? '✓' : '✗'}<small>${p.ok ? VNAME[p.target] + ' ✔' : p.got ? 'heard ' + VNAME[p.got] : 'not heard'}</small></div>`);
            else if (p.type === 'r') chips.push(`<div class="chip ${p.ok ? 'ok' : 'no'}">R ${p.ok ? '✓' : '✗'}<small>${RNAME[p.kind]}</small></div>`);
          }
        };
        if (r.multi) r.multi.forEach((m, k) => chips.push(`<div class="chip ${m.score >= 70 ? 'ok' : 'no'}">${r.words[k].w} ${m.score >= 70 ? '✓' : '✗'}<small>${(m.parts || []).filter((p) => p.type === 'vowel').map((p) => p.got ? 'heard ' + VNAME[p.got] : 'not heard').join(' ') || (m.parts || []).filter((p) => p.type === 'r').map((p) => RNAME[p.kind]).join('')}</small></div>`));
        else addChips(r);
        // R meter highlight
        const rp = (r.multi ? r.multi.flatMap((m) => m.parts || []) : r.parts || []).find((p) => p.type === 'r');
        if (rp && $('#rm')) $('#rm').querySelectorAll('.rtype').forEach((el) => {
          el.className = 'rtype' + (el.dataset.k === rp.kind ? ' on' + (rp.kind === 'french' ? '' : rp.kind === 'weak' ? ' midr' : ' badr') : '');
        });
        const verdict = r.score >= 85 ? pick(PRAISE) : good ? 'Good! 👍' : r.score >= 45 ? pick(MID) : pick(LOW);
        const tipMsg = good ? (r.score >= 85 ? 'That’s exactly it. 💜' : 'Good — and it can be even cleaner.') + (r.msg ? '<br>' + r.msg : '') : r.msg || 'Listen to the model and try again.';
        const canNext = good || attempts >= 3;
        $('#res').innerHTML = `<div class="score" style="--sc:${col}">${r.score}</div>
          <div class="verdict">${verdict}</div>
          <div class="chips">${chips.join('')}</div>
          <div class="fb ${good ? 'good' : ''}">💡 ${tipMsg}${r.notes && r.notes.length ? '<br><small>' + r.notes.join(' ') + '</small>' : ''}</div>
          <div class="actions">
            <button class="pill ghost small" id="me">👂 Hear me</button>
            <button class="pill ghost small" id="again">🔁 Again</button>
            ${canNext ? `<button class="pill" id="nx">${pos + 1 >= flat.length ? 'Finish 🏁' : 'Next →'}</button>` : `<button class="pill ghost small" id="skip">Skip</button>`}
          </div>
          ${Store.data.numbers ? `<div class="numbers">${esc(JSON.stringify(r.multi ? r.multi.map((m) => m.dbg) : r.dbg, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)))}</div>` : ''}`;
        $('#ml').textContent = good ? 'Tap 🎤 to do it again, or go next' : 'Tap 🎤 and try again';
        const lastRec = r.multi ? null : r.rec;
        $('#me').onclick = () => {
          if (r.multi) { let t = 0; r.multi.forEach((m) => { setTimeout(() => playSamples(m.rec.samples, m.rec.fs), t); t += (m.rec.samples.length / m.rec.fs) * 1000 + 250; }); }
          else if (lastRec) playSamples(lastRec.samples, lastRec.fs);
        };
        $('#again').onclick = () => $('#mic').click();
        const nx = $('#nx') || $('#skip');
        nx.onclick = () => { Sfx.pop(); next(); };
        if (r.score >= 85) { Sfx.great(); celebrate($('.score'), false); }
        else if (good) { Sfx.good(); celebrate($('.score'), false); }
        else { Sfx.bad(); wobble($('#card')); }
        setTimeout(() => { const el = $('#res'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 120);
      }
    }

    function sentenceItem(cur, label) {
      const it = cur.it;
      const focus = new Set(it.focus.map((w) => norm(w)[0]));
      const wordsHTML = (marks) => it.s.split(/\s+/).map((tok, k) => {
        const n = norm(tok)[0];
        const cls = (n && focus.has(n) ? 'f ' : '') + (marks ? (marks[k] === true ? 'sw ok' : marks[k] === false ? 'sw no' : 'sw') : 'sw');
        return `<span class="${cls}">${tok}</span>`;
      }).join(' ');
      let attempts = 0;
      stage.innerHTML = `<div class="card" id="card">${label}
        <div class="sentence" id="sent">${wordsHTML()}</div><div class="en center">“${it.en}”</div>
        <div class="hint center">Say the whole sentence. Colored words have your sounds!</div>
        <div class="models"><button class="pill ghost small" id="m1">🔊 Hear it</button><button class="pill ghost small" id="m2">🐢 Slowly</button></div>
        <div class="micwrap"><button class="mic" id="mic"><span class="ring"></span><span class="ring"></span>🎤</button>
          <div class="miclabel" id="ml">${SR ? 'Tap and say the sentence' : 'Tap, say it, then compare with the model'}</div></div>
        <div class="result" id="res"></div></div>`;
      $('#m1').onclick = () => speak(it.s);
      $('#m2').onclick = () => speak(it.s, true);
      $('#mic').onclick = async () => {
        if ('speechSynthesis' in window) speechSynthesis.cancel();
        if (Mic.recording) { Mic.stopNow(); return; }
        $('#res').innerHTML = '';
        if (SR) {
          Sfx.ready(); await sleep(170);
          Mic.release(); // free the mic for the browser's recogniser
          $('#mic').classList.add('rec'); $('#ml').textContent = 'Listening… 👂';
          const out = await recognize();
          if (!$('#mic')) return;
          $('#mic').classList.remove('rec');
          if (!out.ok) {
            if (out.error === 'not-allowed' || out.error === 'service-not-allowed' || out.error === 'network' || out.error === 'start') { selfCheck('The sentence checker isn’t available here, so let’s compare by ear.'); return; }
            $('#ml').textContent = 'I didn’t catch that — tap and try again';
            Sfx.meh(); wobble($('#card')); return;
          }
          attempts++;
          const cmp = compareSentence(it.s, out.alts);
          const toks = it.s.split(/\s+/);
          // map word-level ok back to tokens (tokens may hold punctuation / apostrophes)
          let wiIdx = 0; const marks = toks.map((tok) => { const n = norm(tok); if (!n.length) return null; const ok = n.every((_, k) => cmp.ok[wiIdx + k]); wiIdx += n.length; return ok; });
          let focusMissed = 0; toks.forEach((tok, k) => { const n = norm(tok)[0]; if (n && focus.has(n) && marks[k] === false) focusMissed++; });
          const score = Math.max(0, Math.round(cmp.score * 100 - focusMissed * 10));
          $('#sent').innerHTML = wordsHTML(marks);
          record(cur.key, score);
          const good = score >= 70;
          const col = score >= 85 ? 'var(--good)' : good ? '#4cc38a' : score >= 45 ? 'var(--mid)' : 'var(--bad)';
          $('#res').innerHTML = `<div class="score" style="--sc:${col}">${score}</div>
            <div class="verdict">${score >= 85 ? pick(PRAISE) : good ? 'Good! 👍' : pick(MID)}</div>
            <div class="heard">A French ear heard: “${esc(cmp.alt)}”</div>
            <div class="fb ${good ? 'good' : ''}">💡 ${good ? 'Understood! Red words (if any) are the ones to polish.' : 'The <u>red</u> words weren’t understood. Listen to the model (try 🐢), focus on those, and go again.'}</div>
            <div class="actions"><button class="pill ghost small" id="again">🔁 Again</button>
              ${good || attempts >= 3 ? `<button class="pill" id="nx">${pos + 1 >= flat.length ? 'Finish 🏁' : 'Next →'}</button>` : '<button class="pill ghost small" id="nx">Skip</button>'}</div>`;
          $('#ml').textContent = 'Tap 🎤 to try again';
          $('#again').onclick = () => $('#mic').click();
          $('#nx').onclick = () => { Sfx.pop(); next(); };
          if (good) { score >= 85 ? Sfx.great() : Sfx.good(); celebrate($('.score')); } else { Sfx.bad(); wobble($('#card')); }
        } else selfCheck();
      };
      async function selfCheck(note) {
        try { await Mic.ensure(); } catch (e) { micError(e); return; }
        Sfx.ready(); await sleep(170);
        $('#mic').classList.add('rec'); $('#ml').textContent = 'Listening… 👂';
        const rec = await Mic.record({ maxSec: 6, minSec: 1, silenceStop: 0.9 });
        if (!$('#mic')) return;
        $('#mic').classList.remove('rec');
        $('#res').innerHTML = `${note ? `<div class="heard">${note}</div>` : ''}
          <div class="fb">🎧 Listen to yourself, then to the model. Do they match?</div>
          <div class="actions"><button class="pill ghost small" id="me">👂 Hear me</button><button class="pill ghost small" id="mo">🔊 Model</button></div>
          <div class="actions"><button class="pill" id="yes">😀 Sounds right</button><button class="pill ghost" id="no">🤔 Not yet</button></div>`;
        $('#me').onclick = () => playSamples(rec.samples, rec.fs);
        $('#mo').onclick = () => speak(it.s);
        $('#yes').onclick = () => { record(cur.key, 80); Sfx.good(); celebrate($('#yes')); setTimeout(next, 450); };
        $('#no').onclick = () => { record(cur.key, 40); $('#res').innerHTML = ''; $('#ml').textContent = 'Tap 🎤 and try again'; };
      }
    }

    function summary() {
      const st = lessonStars(L);
      const tricky = [];
      flat.forEach((f) => {
        if ((session[f.key] || 0) < 70) {
          const it = f.it;
          tricky.push(it.w || it.say || it.s || (it.a ? it.a.w + ' / ' + it.b.w : it.words ? it.words.map((w) => w.w).join(' / ') : '?'));
        }
      });
      stage.innerHTML = `<div class="card summary"><div class="big-emoji">${st >= 3 ? '🏆' : st === 2 ? '🎉' : '💪'}</div>
        <h2>${st >= 3 ? 'Incroyable !' : st === 2 ? 'Bravo !' : 'Good practice!'}</h2>
        <div class="bigstars" style="color:${L.color}">${[0, 1, 2].map((i) => `<span style="animation-delay:${0.3 + i * 0.25}s">${i < st ? '★' : '☆'}</span>`).join('')}</div>
        ${tricky.length ? `<p class="muted">Words to keep practising:</p><div class="tricky">${tricky.map((t) => `<span class="chip no">${esc(t)}</span>`).join('')}</div>` : '<p class="muted">Every challenge passed. Ton accent est magnifique ! 💜</p>'}
        <div class="actions"><button class="pill ghost" id="again">🔁 Practise again</button><button class="pill" id="home">🏠 Home</button></div></div>`;
      Sfx.great(); celebrate(null, true);
      $('#again').onclick = () => Lesson(L);
      $('#home').onclick = () => { resetAccent(); Home(); };
    }

    tip();
  }
  function resetAccent() { document.documentElement.style.setProperty('--accent', '#8b6cff'); document.documentElement.style.setProperty('--soft', '#e9e3ff'); }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // unlock audio on first touch (iOS)
  addEventListener('pointerdown', () => { try { audioCtx(); } catch (e) {} }, { once: true });
  window.__bulles = { Store, Mic, DSP, LESSONS, GYM };
  Home();
})();
