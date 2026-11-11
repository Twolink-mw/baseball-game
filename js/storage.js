// localStorage 저장 + 기록 검증/병합(순수 함수)
(function (global) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const { CONFIG } = isNode ? require('./config.js') : global.BB;
  const NLEVELS = CONFIG.LEVELS.length;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function defaultRecord() {
    const unlocked = new Array(NLEVELS).fill(false);
    unlocked[0] = true;
    return {
      v: 1,
      name: '',
      unlocked,
      best: new Array(NLEVELS).fill(null),
      games: 0,
      daily: null,
      settings: { muted: false, padSide: 'right' },
    };
  }

  const isAvg = (x) => x === null || (typeof x === 'number' && isFinite(x) && x >= 0 && x <= 1);
  const isDaily = (d) => d === null || (d && typeof d === 'object' && DATE_RE.test(d.date) && isAvg(d.avg) && d.avg !== null);

  // 가져오기용 엄격 검증. 통과하면 정규화된 기록, 아니면 null
  function validateRecord(obj) {
    if (!obj || typeof obj !== 'object' || obj.v !== 1) return null;
    if (!Array.isArray(obj.unlocked) || obj.unlocked.length !== NLEVELS) return null;
    if (!obj.unlocked.every((b) => typeof b === 'boolean')) return null;
    if (!Array.isArray(obj.best) || obj.best.length !== NLEVELS || !obj.best.every(isAvg)) return null;
    if (!Number.isInteger(obj.games) || obj.games < 0) return null;
    if (obj.daily !== undefined && !isDaily(obj.daily)) return null;
    return normalizeRecord(obj);
  }

  // 불러오기용 관대한 정규화: 알 수 있는 필드는 살리고 나머지는 기본값
  function normalizeRecord(obj) {
    const r = defaultRecord();
    if (!obj || typeof obj !== 'object') return r;
    if (typeof obj.name === 'string') r.name = obj.name.slice(0, CONFIG.NAME_MAX);
    if (Array.isArray(obj.unlocked)) {
      for (let i = 0; i < NLEVELS; i++) if (obj.unlocked[i] === true) r.unlocked[i] = true;
    }
    if (Array.isArray(obj.best)) {
      for (let i = 0; i < NLEVELS; i++) if (isAvg(obj.best[i])) r.best[i] = obj.best[i];
    }
    if (Number.isInteger(obj.games) && obj.games >= 0) r.games = obj.games;
    if (obj.daily && isDaily(obj.daily)) r.daily = { date: obj.daily.date, avg: obj.daily.avg };
    if (obj.settings && typeof obj.settings === 'object') {
      if (typeof obj.settings.muted === 'boolean') r.settings.muted = obj.settings.muted;
      if (obj.settings.padSide === 'left' || obj.settings.padSide === 'right') r.settings.padSide = obj.settings.padSide;
    }
    r.unlocked[0] = true;
    return r;
  }

  // base(현재 기기) + incoming(가져온 기록) 병합. 이름/설정은 현재 기기 값 유지
  function mergeRecords(base, incoming) {
    const a = normalizeRecord(base);
    const b = normalizeRecord(incoming);
    const r = normalizeRecord(a);
    for (let i = 0; i < NLEVELS; i++) {
      r.unlocked[i] = a.unlocked[i] || b.unlocked[i];
      const x = a.best[i];
      const y = b.best[i];
      r.best[i] = x === null ? y : y === null ? x : Math.max(x, y);
    }
    r.games = Math.max(a.games, b.games);
    if (!a.daily) r.daily = b.daily;
    else if (b.daily && b.daily.date > a.daily.date) r.daily = b.daily;
    return r;
  }

  // 게임 결과 반영. 새 기록 객체와 연출 정보를 돌려준다.
  function applyGameResult(record, { levelIndex, avg, mode, date }) {
    const r = normalizeRecord(record);
    r.games++;
    if (mode === 'challenge') {
      const official = !r.daily || r.daily.date !== date;
      if (official) r.daily = { date, avg };
      return { record: r, official, newRecord: false, unlockedLevel: null };
    }
    const prev = r.best[levelIndex];
    if (prev === null || avg > prev) r.best[levelIndex] = avg;
    // 첫 기록이 .000이면 NEW RECORD 연출은 하지 않는다
    const newRecord = prev === null ? avg > 0 : avg > prev;
    let unlockedLevel = null;
    const next = levelIndex + 1;
    if (avg >= CONFIG.UNLOCK_AVG && next < NLEVELS && !r.unlocked[next]) {
      r.unlocked[next] = true;
      unlockedLevel = next;
    }
    return { record: r, official: true, newRecord, unlockedLevel };
  }

  // ---- 브라우저 저장소 (실패해도 게임은 계속) ----
  function load() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(CONFIG.STORAGE_KEY);
      if (!raw) return defaultRecord();
      return normalizeRecord(JSON.parse(raw));
    } catch (e) {
      return defaultRecord();
    }
  }

  function save(record) {
    try {
      global.localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(record));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try {
      global.localStorage.removeItem(CONFIG.STORAGE_KEY);
    } catch (e) {
      /* 저장 불가 환경 */
    }
    return defaultRecord();
  }

  const api = {
    defaultRecord, validateRecord, normalizeRecord, mergeRecords, applyGameResult,
    storage: { load, save, clear },
  };
  if (isNode) module.exports = api;
  else Object.assign((global.BB = global.BB || {}), api);
})(typeof window !== 'undefined' ? window : globalThis);
