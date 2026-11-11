// 시드 가능한 난수 (mulberry32). 게임의 모든 난수는 여기서만 만든다.
(function (global) {
  'use strict';

  function createRng(seed) {
    let a = seed >>> 0;
    function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next,
      range(min, max) {
        return min + (max - min) * next();
      },
      int(n) {
        return Math.floor(next() * n);
      },
      // table: { key: weight } 또는 [[key, weight], ...]
      pickWeighted(table) {
        const entries = Array.isArray(table) ? table : Object.entries(table);
        let total = 0;
        for (const [, w] of entries) total += Math.max(0, w);
        if (total <= 0) return entries[0][0];
        let r = next() * total;
        for (const [k, w] of entries) {
          if (w <= 0) continue;
          r -= w;
          if (r < 0) return k;
        }
        // 부동소수 오차 대비: 마지막 양수 가중치 항목
        for (let i = entries.length - 1; i >= 0; i--) if (entries[i][1] > 0) return entries[i][0];
        return entries[0][0];
      },
    };
  }

  // 문자열 → 32비트 시드 (FNV-1a)
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  const api = { createRng, hashString };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.BB = global.BB || {}), api);
})(typeof window !== 'undefined' ? window : globalThis);
