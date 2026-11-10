/* ============================================================
   Bulles — French pronunciation analysis engine (pure JS, no deps)
   - LPC formant tracking (F1/F2/F3)
   - Vowel classifier for French i / y / u + typical English-speaker errors
   - R detector: French uvular R vs English R vs rolled R vs missing
   - Syllable nucleus segmentation
   ============================================================ */
const DSP = (() => {
  'use strict';

  // ---------- basic helpers ----------
  const median = (arr) => {
    if (!arr.length) return NaN;
    const s = Float64Array.from(arr).sort();
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
  };
  const percentile = (arr, p) => {
    if (!arr.length) return 0;
    const s = Float64Array.from(arr).sort();
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
  };
  const hamming = (n) => {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
    return w;
  };
  const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };

  // ---------- resampling ----------
  function designLowpass(cutNorm, taps) {
    const h = new Float64Array(taps), M = taps - 1;
    let sum = 0;
    for (let n = 0; n < taps; n++) {
      const x = n - M / 2;
      const sinc = x === 0 ? 2 * cutNorm : Math.sin(2 * Math.PI * cutNorm * x) / (Math.PI * x);
      h[n] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * n) / M));
      sum += h[n];
    }
    for (let n = 0; n < taps; n++) h[n] /= sum;
    return h;
  }
  const lpCache = {};
  function decimate(x, fs, targetFs) {
    const factor = Math.max(1, Math.round(fs / targetFs));
    if (factor === 1) return { y: Float64Array.from(x), fs };
    const key = factor;
    const h = lpCache[key] || (lpCache[key] = designLowpass(0.42 / factor, 8 * factor + 1));
    const half = (h.length - 1) / 2;
    const out = new Float64Array(Math.floor(x.length / factor));
    for (let i = 0; i < out.length; i++) {
      const c = i * factor;
      let s = 0;
      for (let k = 0; k < h.length; k++) {
        const idx = c + half - k;
        if (idx >= 0 && idx < x.length) s += h[k] * x[idx];
      }
      out[i] = s;
    }
    return { y: out, fs: fs / factor };
  }

  // ---------- LPC + polynomial roots ----------
  let LAGW = 40;
  function lpc(frame, order, fs = 11000) {
    const n = frame.length, r = new Float64Array(order + 1);
    for (let k = 0; k <= order; k++) {
      let s = 0;
      for (let i = k; i < n; i++) s += frame[i] * frame[i - k];
      r[k] = s;
    }
    if (r[0] <= 1e-12) return null;
    r[0] *= 1.0001;
    // gentle lag window (reduces pitch-harmonic latching)
    for (let k = 1; k <= order; k++) r[k] *= Math.exp(-0.5 * Math.pow((2 * Math.PI * LAGW * k) / fs, 2));
    const a = new Float64Array(order + 1), tmp = new Float64Array(order + 1);
    a[0] = 1;
    let e = r[0];
    for (let i = 1; i <= order; i++) {
      let acc = r[i];
      for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
      const k = -acc / e;
      tmp.set(a);
      for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j];
      a[i] = k;
      e *= 1 - k * k;
      if (e <= 0) return null;
    }
    return a;
  }

  // Durand–Kerner root finder for monic polynomial z^n + a1 z^(n-1) + ... + an
  function polyRoots(a) {
    const n = a.length - 1;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const ang = (2 * Math.PI * i) / n + 0.4;
      re[i] = 0.9 * Math.cos(ang);
      im[i] = 0.9 * Math.sin(ang);
    }
    for (let it = 0; it < 120; it++) {
      let maxd = 0;
      for (let i = 0; i < n; i++) {
        let pr = 1, pi = 0;
        for (let k = 1; k <= n; k++) {
          const nr = pr * re[i] - pi * im[i] + a[k];
          pi = pr * im[i] + pi * re[i];
          pr = nr;
        }
        let dr = 1, di = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const xr = re[i] - re[j], xi = im[i] - im[j];
          const nr = dr * xr - di * xi;
          di = dr * xi + di * xr;
          dr = nr;
        }
        const den = dr * dr + di * di;
        if (den < 1e-300) continue;
        const qr = (pr * dr + pi * di) / den, qi = (pi * dr - pr * di) / den;
        re[i] -= qr; im[i] -= qi;
        const d = Math.abs(qr) + Math.abs(qi);
        if (d > maxd) maxd = d;
      }
      if (maxd < 1e-9) break;
    }
    return { re, im };
  }

  function formantsFromLpc(a, fs, f0 = 0) {
    const { re, im } = polyRoots(a);
    const cands = [];
    for (let i = 0; i < re.length; i++) {
      if (im[i] <= 1e-3) continue;
      const freq = (Math.atan2(im[i], re[i]) * fs) / (2 * Math.PI);
      const mag = Math.hypot(re[i], im[i]);
      const bw = (-Math.log(mag) * fs) / Math.PI;
      if (freq > 180 && freq < fs / 2 - 200 && bw > 0 && bw < 1150) cands.push({ freq, bw });
    }
    cands.sort((x, y) => x.freq - y.freq);
    // drop a low pole that just latched onto the 2nd pitch harmonic (common for higher voices)
    if (f0 > 150) {
      const low = cands.filter((c) => c.freq <= 1100);
      const under = cands.filter((c) => c.freq <= 1700).length;
      if (low.length >= 2 && under >= 3) {
        const bad = low.find((c) => Math.abs(c.freq - 2 * f0) < 0.12 * 2 * f0);
        if (bad) cands.splice(cands.indexOf(bad), 1);
      }
    }
    // assign F1, F2, F3
    let F1 = NaN, F2 = NaN, F3 = NaN, idx = 0, bwSum = 0;
    for (; idx < cands.length; idx++) if (cands[idx].freq >= 180 && cands[idx].freq <= 1100 && cands[idx].bw < 400) { F1 = cands[idx].freq; bwSum += cands[idx].bw; idx++; break; }
    if (!isNaN(F1)) {
      for (; idx < cands.length; idx++) if (cands[idx].freq >= Math.max(F1 + 150, 550) && cands[idx].freq <= 3200 && cands[idx].bw < 700) { F2 = cands[idx].freq; bwSum += cands[idx].bw; idx++; break; }
    }
    if (!isNaN(F2)) {
      for (; idx < cands.length; idx++) if (cands[idx].freq >= F2 + 150 && cands[idx].freq <= 4300) { F3 = cands[idx].freq; bwSum += cands[idx].bw; break; }
    }
    const quality = isNaN(F2) ? Infinity : bwSum + (isNaN(F3) ? 900 : 0);
    return { F1, F2, F3, quality };
  }

  // ---------- FFT (radix-2, in place) ----------
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const ur = re[i + j], ui = im[i + j];
          const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
          const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
          re[i + j] = ur + vr; im[i + j] = ui + vi;
          re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }

  // ---------- pitch / voicing ----------
  function voicingAt(y, start, win, fs) {
    let mean = 0;
    for (let i = 0; i < win; i++) mean += y[start + i];
    mean /= win;
    const minLag = Math.floor(fs / 500), maxLag = Math.min(Math.floor(fs / 70), win - 40);
    let best = 0, bestLag = 0;
    const rs = new Float64Array(maxLag + 2);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0, e1 = 0, e2 = 0;
      for (let i = 0; i < win - lag; i++) {
        const a = y[start + i] - mean, b = y[start + i + lag] - mean;
        num += a * b; e1 += a * a; e2 += b * b;
      }
      const r = num / (Math.sqrt(e1 * e2) + 1e-12);
      rs[lag] = r;
      if (r > best) { best = r; bestLag = lag; }
    }
    // avoid sub-harmonic (octave-down) errors: take the shortest lag that is a local peak close to the best
    for (let lag = minLag + 1; lag < bestLag; lag++) {
      if (rs[lag] >= 0.9 * best && rs[lag] >= rs[lag - 1] && rs[lag] >= rs[lag + 1]) { bestLag = lag; break; }
    }
    return { voicing: best, f0: bestLag ? fs / bestLag : 0 };
  }

  // double pre-emphasis (flattens the ~-12 dB/oct voice spectrum so F2/F3 are fitted well)
  const preEmph1 = (y, n) => y[n] - 0.97 * (y[n - 1] || 0);
  // try single and double pre-emphasis, keep the cleaner fit (narrower formant bandwidths)
  function bestFormants(y, start, win, ham, buf, order, dfs, f0) {
    let best = { F1: NaN, F2: NaN, F3: NaN, quality: Infinity };
    for (const pe of [preEmph1, preEmph2]) {
      for (let i = 0; i < win; i++) buf[i] = pe(y, start + i) * ham[i];
      const a = lpc(buf, order, dfs);
      if (!a) continue;
      const f = formantsFromLpc(a, dfs, f0);
      if (f.quality < best.quality) best = f;
    }
    return best;
  }
  const preEmph2 = (y, n) => {
    const a = y[n] - 0.97 * (y[n - 1] || 0);
    const b = (y[n - 1] || 0) - 0.97 * (y[n - 2] || 0);
    return a - 0.97 * b;
  };
  // ---------- frame analysis ----------
  /** Analyse a mono signal. Returns {frames, fs, peakRms, noiseRms}. */
  function analyze(x, fs) {
    const dec = decimate(x, fs, 11000);
    const y = dec.y, dfs = dec.fs;
    const hop = Math.round(dfs * 0.01), win = Math.round(dfs * 0.03);
    const order = Math.min(16, Math.round(dfs / 1000) + 2);
    const ham = hamming(win);
    const buf = new Float64Array(win);
    const N = nextPow2(Math.round(fs * 0.04));
    const fre = new Float64Array(N), fim = new Float64Array(N);
    const hamN = hamming(N);
    const binHz = fs / N;
    const frames = [];
    for (let start = 2; start + win <= y.length; start += hop) {
      const t = (start + win / 2) / dfs;
      let s = 0;
      for (let i = 0; i < win; i++) s += y[start + i] * y[start + i];
      const rms = Math.sqrt(s / win);
      const fr = { t, rms, voicing: 0, f0: 0, F1: NaN, F2: NaN, F3: NaN, centroid: 0, flat: 0, band: 0, zcr: 0 };
      if (rms > 1e-5) {
        const v = voicingAt(y, start, win, dfs);
        fr.voicing = v.voicing; fr.f0 = v.f0;
        const bf = bestFormants(y, start, win, ham, buf, order, dfs, v.voicing > 0.6 ? v.f0 : 0);
        fr.F1 = bf.F1; fr.F2 = bf.F2; fr.F3 = bf.F3;
        // full-rate spectrum for frication analysis
        const c = Math.round(t * fs) - N / 2;
        let zc = 0, prev = 0;
        for (let i = 0; i < N; i++) {
          const xv = c + i >= 0 && c + i < x.length ? x[c + i] : 0;
          fre[i] = xv * hamN[i]; fim[i] = 0;
          if (i && (xv >= 0) !== (prev >= 0)) zc++;
          prev = xv;
        }
        fr.zcr = zc / N;
        fft(fre, fim);
        let num = 0, den = 0, logSum = 0, linSum = 0, cnt = 0, band = 0;
        const lo = Math.floor(300 / binHz), hi = Math.min(N / 2 - 1, Math.floor(8000 / binHz));
        const flo = Math.floor(1000 / binHz), fhi = Math.floor(4000 / binHz);
        for (let k = lo; k <= hi; k++) {
          const p = fre[k] * fre[k] + fim[k] * fim[k];
          num += k * binHz * p; den += p;
          if (k >= flo && k <= fhi) { logSum += Math.log(p + 1e-20); linSum += p; cnt++; }
          if (k * binHz >= 700 && k * binHz <= 4000) band += p;
        }
        fr.centroid = den > 0 ? num / den : 0;
        fr.band = den > 0 ? band / den : 0;
        // local spectral flatness in 1–4 kHz: noise ≈ 0.5, harmonics ≪ 0.5 (independent of spectral shape)
        const sb = Math.max(8, Math.round(375 / binHz));
        let wsum = 0, fsum = 0;
        for (let k0 = flo; k0 + sb <= fhi; k0 += sb) {
          let lg = 0, ln = 0;
          for (let k = k0; k < k0 + sb; k++) { const p = fre[k] * fre[k] + fim[k] * fim[k]; lg += Math.log(p + 1e-20); ln += p; }
          if (ln <= 0) continue;
          const fl = Math.exp(lg / sb) / (ln / sb);
          wsum += ln; fsum += fl * ln;
        }
        fr.flat = wsum > 0 ? fsum / wsum : 0;
      }
      frames.push(fr);
    }
    const rmsArr = frames.map((f) => f.rms);
    const peakRms = percentile(rmsArr, 0.97);
    const noiseRms = Math.max(percentile(rmsArr, 0.1), 1e-5);
    return { frames, fs, dfs, peakRms, noiseRms, duration: x.length / fs };
  }

  /** Fast single-frame formant estimate for live visuals (chunk = most recent samples). */
  function liveFrame(chunk, fs) {
    const dec = decimate(chunk, fs, 11000);
    const y = dec.y, dfs = dec.fs;
    const win = Math.min(y.length - 2, Math.round(dfs * 0.03));
    if (win < 100) return null;
    const start = y.length - win - 1;
    if (start < 2) return null;
    let s = 0;
    for (let i = 0; i < win; i++) s += y[start + i] * y[start + i];
    const rms = Math.sqrt(s / win);
    const v = voicingAt(y, start, win, dfs);
    const ham = hamming(win), buf = new Float64Array(win);
    const f = bestFormants(y, start, win, ham, buf, Math.min(16, Math.round(dfs / 1000) + 2), dfs, v.voicing > 0.6 ? v.f0 : 0);
    return { rms, voicing: v.voicing, ...f };
  }

  // ---------- speaker templates ----------
  const DEFAULT_CAL = {
    i: { F1: 300, F2: 2450, F3: 3150 },
    a: { F1: 800, F2: 1400, F3: 2750 },
    u: { F1: 330, F2: 800, F3: 2550 },
  };
  function templates(cal) {
    const c = cal || DEFAULT_CAL;
    const { i, a, u } = c;
    const T = {
      i: { F1: i.F1, F2: i.F2, F3: i.F3 },
      y: { F1: i.F1 * 1.02, F2: u.F2 + 0.66 * (i.F2 - u.F2), F3: i.F3 * 0.8 },
      u: { F1: u.F1, F2: u.F2, F3: u.F3 },
      I: { F1: i.F1 + 0.3 * (a.F1 - i.F1), F2: u.F2 + 0.82 * (i.F2 - u.F2), F3: i.F3 * 0.93 }, // English "ih" (sit)
      Y: { F1: u.F1 * 1.04, F2: u.F2 + 0.38 * (i.F2 - u.F2), F3: (u.F3 + i.F3 * 0.8) / 2 }, // central "oo" (English goose)
      U: { F1: u.F1 + 0.32 * (a.F1 - u.F1), F2: u.F2 * 1.25, F3: u.F3 }, // English "oo" in book
      a: { F1: a.F1, F2: a.F2, F3: a.F3 },
      e: { F1: i.F1 + 0.5 * (a.F1 - i.F1), F2: a.F2 + 0.6 * (i.F2 - a.F2), F3: i.F3 * 0.92 },
    };
    return T;
  }
  const W = { F1: 0.45, F2: 1.0, F3: 0.45 };
  function vowelDistance(f, t) {
    let d = 0;
    d += Math.pow(W.F1 * Math.log(f.F1 / t.F1), 2);
    d += Math.pow(W.F2 * Math.log(f.F2 / t.F2), 2);
    if (!isNaN(f.F3) && t.F3) d += Math.pow(W.F3 * Math.log(f.F3 / t.F3), 2);
    return Math.sqrt(d);
  }
  function classifyVowel(f, T) {
    let best = null, bestD = Infinity;
    const scores = {};
    let z = 0;
    for (const k of Object.keys(T)) {
      const d = vowelDistance(f, T[k]);
      scores[k] = Math.exp(-(d * d) / (2 * 0.1 * 0.1));
      z += scores[k];
      if (d < bestD) { bestD = d; best = k; }
    }
    for (const k of Object.keys(scores)) scores[k] /= z || 1;
    return { label: best, dist: bestD, probs: scores };
  }

  // ---------- frame categorisation ----------
  function speechGate(A) {
    return Math.max(A.noiseRms * 3, A.peakRms * 0.06, 2e-4);
  }
  function isVowelFrame(fr, A) {
    return fr.rms > Math.max(A.peakRms * 0.14, speechGate(A)) && fr.voicing > 0.6 && !isNaN(fr.F1) && !isNaN(fr.F2);
  }

  // ---------- syllable nuclei ----------
  function nuclei(A) {
    const fr = A.frames;
    const thr = Math.max(A.peakRms * 0.14, speechGate(A));
    const ok = fr.map((f) => f.rms > thr && f.voicing > 0.6);
    // smoothed energy
    const e = fr.map((f, i) => {
      let s = 0, n = 0;
      for (let k = -2; k <= 2; k++) if (fr[i + k]) { s += fr[i + k].rms; n++; }
      return s / n;
    });
    const runs = [];
    let st = -1;
    for (let i = 0; i <= fr.length; i++) {
      if (i < fr.length && ok[i]) { if (st < 0) st = i; }
      else if (st >= 0) {
        // bridge tiny gaps (1 frame)
        if (i < fr.length - 1 && ok[i + 1]) continue;
        runs.push([st, i - 1]); st = -1;
      }
    }
    // split runs at energy dips
    const segs = [];
    for (const [a, b] of runs) {
      let cur = a;
      for (let i = a + 3; i <= b - 3; i++) {
        if (e[i] <= e[i - 1] && e[i] <= e[i + 1]) {
          let lp = 0, rp = 0;
          for (let k = cur; k < i; k++) lp = Math.max(lp, e[k]);
          for (let k = i + 1; k <= b; k++) rp = Math.max(rp, e[k]);
          if (e[i] < 0.62 * Math.min(lp, rp)) { segs.push([cur, i - 1]); cur = i + 1; }
        }
      }
      segs.push([cur, b]);
    }
    return segs
      .filter(([a, b]) => b - a + 1 >= 4)
      .map(([a, b]) => {
        let peak = 0;
        for (let k = a; k <= b; k++) peak = Math.max(peak, fr[k].rms);
        const core = [];
        for (let k = a; k <= b; k++) if (fr[k].rms >= 0.45 * peak && ok[k] && !isNaN(fr[k].F1) && !isNaN(fr[k].F2)) core.push(fr[k]);
        const q = Math.floor(core.length * 0.15);
        const mid = core.slice(q, core.length - q || undefined);
        const use = mid.length >= 2 ? mid : core;
        if (core.length < 2) return null;
        return {
          start: fr[a].t, end: fr[b].t, frames: core,
          F1: median(use.map((f) => f.F1)), F2: median(use.map((f) => f.F2)), F3: median(use.filter((f) => !isNaN(f.F3)).map((f) => f.F3)),
          energy: peak * (b - a + 1),
        };
      })
      .filter(Boolean);
  }

  // pick n nuclei (keeping order) maximising energy
  function pickNuclei(nu, n) {
    if (nu.length <= n) return nu;
    const idx = nu.map((x, i) => i).sort((p, q) => nu[q].energy - nu[p].energy).slice(0, n).sort((p, q) => p - q);
    return idx.map((i) => nu[i]);
  }

  // ---------- vowel evaluation ----------
  /**
   * expected: array of vowel targets, e.g. ['y'] or ['*','y'] ('*' = not checked)
   * returns {ok, score, syllables:[{target, got, score, ok}], heard}
   */
  function evalVowels(A, expected, cal) {
    const T = templates(cal);
    const nu = nuclei(A);
    if (!nu.length) return { heard: false, score: 0, syllables: expected.map((t) => ({ target: t, got: null, score: 0, ok: t === '*' })) };
    const chosen = pickNuclei(nu, expected.length);
    const syl = expected.map((target, k) => {
      const n = chosen[k];
      if (!n) return { target, got: null, score: target === '*' ? 100 : 0, ok: target === '*' };
      const f = { F1: n.F1, F2: n.F2, F3: n.F3 };
      const c = classifyVowel(f, T);
      let glide = false;
      if (target === 'y' && n.frames.length >= 8) {
        const q = Math.max(2, Math.floor(n.frames.length / 4));
        const f2s = median(n.frames.slice(0, q).map((x) => x.F2));
        const f2e = median(n.frames.slice(-q).map((x) => x.F2));
        if (f2s > f2e * 1.35 && f2s > T.y.F2 * 1.05) glide = true; // English "you" slide
      }
      if (target === '*') return { target, got: c.label, score: 100, ok: true, f };
      const p = c.probs[target] || 0;
      let score = Math.round(100 * Math.min(1, p / 0.55));
      if (c.label === target) score = Math.max(score, 72);
      if (glide) score = Math.min(score, 55);
      return { target, got: c.label, score, ok: score >= 70, glide, f };
    });
    const checked = syl.filter((s) => s.target !== '*');
    const score = checked.length ? Math.round(checked.reduce((s, x) => s + x.score, 0) / checked.length) : 100;
    return { heard: true, score, syllables: syl, nucleiCount: nu.length };
  }

  /** Sustained vowel or glide: per-frame classification. target 'y' or glide 'iy' */
  function evalSustained(A, target, cal) {
    const T = templates(cal);
    const vf = A.frames.filter((f) => isVowelFrame(f, A));
    if (vf.length < 8) return { heard: false, score: 0 };
    const labs = vf.map((f) => classifyVowel(f, T).label);
    // median-like smoothing (majority over 5)
    const sm = labs.map((l, i) => {
      const cnt = {};
      for (let k = -2; k <= 2; k++) if (labs[i + k]) cnt[labs[i + k]] = (cnt[labs[i + k]] || 0) + 1;
      return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    });
    const tally = (arr) => { const c = {}; arr.forEach((l) => (c[l] = (c[l] || 0) + 1)); return c; };
    if (target.length === 2) {
      const q = Math.floor(sm.length * 0.4);
      const first = sm.slice(0, q), last = sm.slice(-q);
      const s1 = first.filter((l) => l === target[0]).length / first.length;
      const s2 = last.filter((l) => l === target[1]).length / last.length;
      const t1 = tally(first), t2 = tally(last);
      const top = (t) => Object.keys(t).sort((a, b) => t[b] - t[a])[0];
      return {
        heard: true, score: Math.round(100 * Math.min(1, (s1 + s2) / 2 / 0.6)),
        parts: [{ target: target[0], got: top(t1), share: s1 }, { target: target[1], got: top(t2), share: s2 }],
        track: vf.map((f, i) => ({ F1: f.F1, F2: f.F2, l: sm[i] })),
      };
    }
    const share = sm.filter((l) => l === target).length / sm.length;
    const t = tally(sm);
    const others = Object.keys(t).filter((k) => k !== target).sort((a, b) => t[b] - t[a]);
    return {
      heard: true, share, score: Math.round(100 * Math.min(1, share / 0.6)),
      got: share >= 0.5 ? target : others[0], track: vf.map((f, i) => ({ F1: f.F1, F2: f.F2, l: sm[i] })),
    };
  }

  // ---------- R detection ----------
  function envelope(x, fs) {
    // rectify + 4th-order Butterworth low-pass at 45 Hz (removes pitch ripple, keeps 20–35 Hz trill beats)
    const fc = 45, w0 = (2 * Math.PI * fc) / fs, alpha = Math.sin(w0) / (2 * Math.SQRT1_2), cw = Math.cos(w0);
    const b0 = (1 - cw) / 2, b1 = 1 - cw, b2 = (1 - cw) / 2, a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
    let v = Float64Array.from(x, Math.abs);
    for (let pass = 0; pass < 2; pass++) {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      const o = new Float64Array(v.length);
      for (let i = 0; i < v.length; i++) {
        const yv = (b0 * v[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
        x2 = x1; x1 = v[i]; y2 = y1; y1 = yv; o[i] = yv;
      }
      v = o;
    }
    const h = Math.round(fs * 0.002), env = [];
    for (let i = 0; i < v.length; i += h) env.push(Math.max(0, v[i]));
    return { env, dt: h / fs };
  }
  function trillCount(x, fs, tStart, tEnd) {
    const { env, dt } = envelope(x, fs);
    const a = Math.max(1, Math.floor(tStart / dt)), b = Math.min(env.length - 2, Math.floor(tEnd / dt));
    // local maxima/minima
    const ext = [];
    for (let i = a; i <= b; i++) {
      if (env[i] > env[i - 1] && env[i] >= env[i + 1]) ext.push({ i, v: env[i], max: true });
      else if (env[i] < env[i - 1] && env[i] <= env[i + 1]) ext.push({ i, v: env[i], max: false });
    }
    // collapse to alternating significant extrema
    let best = 0, run = 0, lastMax = null;
    for (let k = 1; k < ext.length - 1; k++) {
      const m = ext[k];
      if (m.max) continue;
      // nearest maxima left and right
      let L = null, R = null;
      for (let j = k - 1; j >= 0; j--) if (ext[j].max) { L = ext[j]; break; }
      for (let j = k + 1; j < ext.length; j++) if (ext[j].max) { R = ext[j]; break; }
      if (!L || !R) continue;
      const depth = m.v / Math.min(L.v, R.v);
      const spacing = (R.i - L.i) * dt;
      if (depth < 0.45 && spacing >= 0.02 && spacing <= 0.065) {
        if (lastMax && L.i === lastMax.i) run++; else run = 1;
        lastMax = R;
        best = Math.max(best, run);
      }
    }
    return best;
  }

  /**
   * Returns {kind: 'french'|'english'|'rolled'|'weak'|'silent', score, stats}
   */
  function evalR(A, x, cal) {
    const c = cal || DEFAULT_CAL;
    const gate = speechGate(A);
    const fr = A.frames;
    const speech = fr.filter((f) => f.rms > gate);
    if (speech.length < 5) return { kind: 'silent', score: 0 };
    const f3thr = Math.min(0.74 * c.a.F3, 2150);
    // English R: voiced frames with very low F3
    let engRun = 0, engBest = 0, fricRun = 0, fricBest = 0, fricTotal = 0;
    for (const f of fr) {
      const isSpeech = f.rms > gate * 0.8;
      const eng = isSpeech && f.voicing > 0.6 && f.flat < 0.3 && !isNaN(f.F3) && f.F3 < f3thr && f.F2 > 850 && f.F2 < 1750 && f.F3 - f.F2 < 1000 && f.F1 < 650;
      engRun = eng ? engRun + 1 : 0;
      engBest = Math.max(engBest, engRun);
      const fric = f.rms > Math.max(A.noiseRms * 3, A.peakRms * 0.03) && f.flat > 0.33 && f.band > 0.25 && f.centroid > 450 && f.centroid < 3000;
      fricRun = fric ? fricRun + 1 : 0;
      if (fric) fricTotal++;
      fricBest = Math.max(fricBest, fricRun);
    }
    const t0 = speech[0].t, t1 = speech[speech.length - 1].t;
    const trill = trillCount(x, A.fs, t0, Math.max(t0, t1 - 0.15));
    const stats = { engBest, fricBest, fricTotal, trill, speechFrames: speech.length, f3thr: Math.round(f3thr) };
    if (engBest >= 4) return { kind: 'english', score: 20, stats };
    if (fricBest >= 3) return { kind: 'french', score: Math.min(100, 78 + fricBest * 3), stats };
    if (trill >= 2) return { kind: 'rolled', score: 40, stats };
    return { kind: 'weak', score: 45, stats };
  }

  /** For sustained "rrrr": share of speech frames that are frication. */
  function evalRSustained(A, x, cal) {
    const r = evalR(A, x, cal);
    if (r.kind === 'silent') return r;
    const share = r.stats.fricTotal / Math.max(1, r.stats.speechFrames);
    r.share = share;
    if (r.kind === 'french') r.score = Math.round(100 * Math.min(1, share / 0.45));
    if (r.kind === 'french' && r.score < 70) r.kind = 'weak';
    return r;
  }

  // ---------- calibration ----------
  function calibrationVowel(A) {
    const vf = A.frames.filter((f) => isVowelFrame(f, A));
    if (vf.length < 10) return null;
    const q = Math.floor(vf.length * 0.2);
    const mid = vf.slice(q, vf.length - q);
    return {
      F1: median(mid.map((f) => f.F1)),
      F2: median(mid.map((f) => f.F2)),
      F3: median(mid.filter((f) => !isNaN(f.F3)).map((f) => f.F3)),
      f0: median(mid.map((f) => f.f0)),
    };
  }
  function validCalibration(c) {
    return c && c.i && c.a && c.u && c.i.F2 > c.u.F2 * 1.7 && c.a.F1 > c.i.F1 * 1.5 && c.a.F1 > c.u.F1 * 1.4 && !isNaN(c.i.F3);
  }

  return {
    setLagWidth: (b) => (LAGW = b), analyze, liveFrame, templates, classifyVowel, evalVowels, evalSustained, evalR, evalRSustained,
    calibrationVowel, validCalibration, nuclei, DEFAULT_CAL, isVowelFrame, speechGate, median,
  };
})();
if (typeof module !== 'undefined') module.exports = DSP;
