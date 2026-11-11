// localStorage 저장 + 타자별 기록 관리(순수 함수)
(function (global) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const { CONFIG } = isNode ? require('./config.js') : global.BB;
  const NLEVELS = CONFIG.LEVELS.length;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // ---- 이름 ----
  // 앞뒤 공백 제거, 연속 공백은 하나로, 제어 문자 제거. 1~NAME_MAX자가 아니면 null
  function normalizeName(str) {
    if (typeof str !== 'string') return null;
    // eslint-disable-next-line no-control-regex
    const s = str.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
    const len = Array.from(s).length;
    if (len < 1 || len > CONFIG.NAME_MAX) return null;
    return s;
  }

  // 같은 타자 판정용 키 (영문 대소문자 무시)
  function playerKey(name) {
    const n = normalizeName(name);
    return n === null ? null : n.toLowerCase();
  }

  // ---- 기본값/정규화 ----
  function defaultPlayer(name) {
    const unlocked = new Array(NLEVELS).fill(false);
    unlocked[0] = true;
    return { name, bats: 'R', unlocked, best: new Array(NLEVELS).fill(null), hits: 0, atBats: 0, games: 0, daily: null };
  }

  function defaultRecord() {
    return { v: 2, current: null, players: {}, settings: { muted: false, padSide: 'right' } };
  }

  const isAvg = (x) => x === null || (typeof x === 'number' && isFinite(x) && x >= 0 && x <= 1);
  const isCount = (x) => Number.isInteger(x) && x >= 0;
  const isBats = (b) => b === 'R' || b === 'L'; // 우타 / 좌타
  const isDaily = (d) => d === null || (!!d && typeof d === 'object' && DATE_RE.test(d.date) && isAvg(d.avg) && d.avg !== null);

  function normalizePlayer(obj, name) {
    const p = defaultPlayer(name);
    if (!obj || typeof obj !== 'object') return p;
    if (isBats(obj.bats)) p.bats = obj.bats;
    if (Array.isArray(obj.unlocked)) {
      for (let i = 0; i < NLEVELS; i++) if (obj.unlocked[i] === true) p.unlocked[i] = true;
    }
    if (Array.isArray(obj.best)) {
      for (let i = 0; i < NLEVELS; i++) if (isAvg(obj.best[i])) p.best[i] = obj.best[i];
    }
    if (isCount(obj.atBats)) p.atBats = obj.atBats;
    if (isCount(obj.hits) && obj.hits <= p.atBats) p.hits = obj.hits;
    if (isCount(obj.games)) p.games = obj.games;
    if (obj.daily && isDaily(obj.daily)) p.daily = { date: obj.daily.date, avg: obj.daily.avg };
    p.unlocked[0] = true;
    return p;
  }

  function normalizeSettings(r, obj) {
    if (obj && typeof obj === 'object') {
      if (typeof obj.muted === 'boolean') r.settings.muted = obj.muted;
      if (obj.padSide === 'left' || obj.padSide === 'right') r.settings.padSide = obj.padSide;
    }
  }

  // v1(기기 하나에 기록 하나) → v2. 게임 기록이 있으면 타자 한 명으로 옮긴다
  function migrateV1(obj) {
    const r = defaultRecord();
    normalizeSettings(r, obj.settings);
    if (isCount(obj.games) && obj.games > 0) {
      const name = normalizeName(obj.name) || '타자1';
      const key = playerKey(name);
      r.players[key] = normalizePlayer(Object.assign({}, obj, { hits: 0, atBats: 0 }), name);
      r.current = key;
    }
    return r;
  }

  // 불러오기용 관대한 정규화: 알 수 있는 필드는 살리고 나머지는 기본값
  function normalizeRecord(obj) {
    if (!obj || typeof obj !== 'object') return defaultRecord();
    if (obj.v === 1 || (obj.v === undefined && Array.isArray(obj.unlocked))) return migrateV1(obj);
    const r = defaultRecord();
    normalizeSettings(r, obj.settings);
    if (obj.players && typeof obj.players === 'object') {
      for (const p of Object.values(obj.players)) {
        if (Object.keys(r.players).length >= CONFIG.MAX_PLAYERS) break;
        const name = p && normalizeName(p.name);
        if (!name) continue;
        const key = playerKey(name);
        if (!r.players[key]) r.players[key] = normalizePlayer(p, name);
      }
    }
    if (typeof obj.current === 'string' && r.players[obj.current]) r.current = obj.current;
    return r;
  }

  // 가져오기용 엄격 검증. 통과하면 정규화된 기록, 아니면 null
  function validatePlayer(p) {
    return (
      !!p && typeof p === 'object' &&
      normalizeName(p.name) !== null &&
      Array.isArray(p.unlocked) && p.unlocked.length === NLEVELS && p.unlocked.every((b) => typeof b === 'boolean') &&
      Array.isArray(p.best) && p.best.length === NLEVELS && p.best.every(isAvg) &&
      isCount(p.hits) && isCount(p.atBats) && p.hits <= p.atBats && isCount(p.games) &&
      (p.daily === undefined || isDaily(p.daily)) &&
      (p.bats === undefined || isBats(p.bats))
    );
  }

  function validateRecord(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.v === 1) {
      // 이전 버전 내보내기 파일
      if (!Array.isArray(obj.unlocked) || obj.unlocked.length !== NLEVELS || !obj.unlocked.every((b) => typeof b === 'boolean')) return null;
      if (!Array.isArray(obj.best) || obj.best.length !== NLEVELS || !obj.best.every(isAvg)) return null;
      if (!isCount(obj.games)) return null;
      if (obj.daily !== undefined && !isDaily(obj.daily)) return null;
      return normalizeRecord(obj);
    }
    if (obj.v !== 2 || !obj.players || typeof obj.players !== 'object' || Array.isArray(obj.players)) return null;
    if (!Object.values(obj.players).every(validatePlayer)) return null;
    return normalizeRecord(obj);
  }

  // ---- 타자 ----
  // 이름으로 타자를 찾거나 만든 뒤 현재 타자로 지정. { record, key, created } 또는 { error: 'invalid'|'full' }
  // bats('R'|'L')를 주면 그 타자의 타석 방향도 바꾼다. 생략하면 새 타자는 우타, 기존 타자는 그대로
  function ensurePlayer(record, name, bats) {
    const n = normalizeName(name);
    if (n === null) return { error: 'invalid' };
    const r = normalizeRecord(record);
    const key = playerKey(n);
    let created = false;
    if (!r.players[key]) {
      if (Object.keys(r.players).length >= CONFIG.MAX_PLAYERS) return { error: 'full' };
      r.players[key] = defaultPlayer(n);
      created = true;
    }
    if (isBats(bats)) r.players[key].bats = bats;
    r.current = key;
    return { record: r, key, created };
  }

  function careerAvg(p) {
    return p.atBats > 0 ? p.hits / p.atBats : null;
  }

  // 순위: 통산 타율 내림차순, 동률이면 타수 많은 순, 타수 0은 맨 아래
  function rankPlayers(record) {
    const r = normalizeRecord(record);
    return Object.entries(r.players)
      .map(([key, p]) => Object.assign({ key, career: careerAvg(p) }, p))
      .sort((a, b) => {
        if ((a.atBats > 0) !== (b.atBats > 0)) return a.atBats > 0 ? -1 : 1;
        if (a.career !== b.career) return (b.career || 0) - (a.career || 0);
        if (a.atBats !== b.atBats) return b.atBats - a.atBats;
        return a.name.localeCompare(b.name);
      });
  }

  function deletePlayer(record, key) {
    const r = normalizeRecord(record);
    delete r.players[key];
    if (r.current === key) r.current = null;
    return r;
  }

  // ---- 게임 결과 ----
  // 일반 게임: 통산(안타/타수) 누적, 최고 타율, 다음 레벨 해제. 챌린지: 그날 첫 판만 daily에 기록
  function applyGameResult(record, { playerKey: key, levelIndex, hits, atBats, mode, date }) {
    const r = normalizeRecord(record);
    const p = r.players[key];
    if (!p) throw new Error('없는 타자: ' + key);
    const avg = atBats > 0 ? hits / atBats : 0;
    const careerBefore = careerAvg(p);
    p.games++;
    if (mode === 'challenge') {
      const official = !p.daily || p.daily.date !== date;
      if (official) p.daily = { date, avg };
      return { record: r, official, newRecord: false, unlockedLevel: null, careerBefore, careerAfter: careerBefore };
    }
    p.hits += hits;
    p.atBats += atBats;
    const prev = p.best[levelIndex];
    if (prev === null || avg > prev) p.best[levelIndex] = avg;
    // 첫 기록이 .000이면 NEW RECORD 연출은 하지 않는다
    const newRecord = prev === null ? avg > 0 : avg > prev;
    let unlockedLevel = null;
    const next = levelIndex + 1;
    if (next < NLEVELS && avg >= CONFIG.UNLOCK_AVG[levelIndex] && next < NLEVELS && !p.unlocked[next]) {
      p.unlocked[next] = true;
      unlockedLevel = next;
    }
    return { record: r, official: true, newRecord, unlockedLevel, careerBefore, careerAfter: careerAvg(p) };
  }

  // ---- 가져오기 병합 ----
  // 타자별: 최고 타율 큰 값, 해제 OR, 통산/게임 수는 타수가 많은 쪽(합치면 중복 집계), daily는 늦은 날짜.
  // 한쪽에만 있는 타자는 추가. 현재 타자/설정/타석 방향은 base(현재 기기) 유지
  function mergeRecords(base, incoming) {
    const r = normalizeRecord(base);
    const b = normalizeRecord(incoming);
    for (const [key, q] of Object.entries(b.players)) {
      const p = r.players[key];
      if (!p) {
        if (Object.keys(r.players).length < CONFIG.MAX_PLAYERS) r.players[key] = clone(q);
        continue;
      }
      for (let i = 0; i < NLEVELS; i++) {
        p.unlocked[i] = p.unlocked[i] || q.unlocked[i];
        const x = p.best[i];
        const y = q.best[i];
        p.best[i] = x === null ? y : y === null ? x : Math.max(x, y);
      }
      if (q.atBats > p.atBats) {
        p.hits = q.hits;
        p.atBats = q.atBats;
      }
      p.games = Math.max(p.games, q.games);
      if (!p.daily || (q.daily && q.daily.date > p.daily.date)) p.daily = q.daily ? clone(q.daily) : p.daily;
    }
    return r;
  }

  // ---- 기록 백업: 내보내기/가져오기 (기기 간 이동, 서버 없음) ----
  // 내보내기 JSON 텍스트 (v 필드 포함)
  function exportRecord(record) {
    return JSON.stringify(normalizeRecord(record));
  }

  // 가져오기: 텍스트 → 검증 → 타자별 병합. 실패하면 { error }, 기존 기록은 건드리지 않음
  // 성공: { record, added: [이름], updated: [이름], skipped: [이름](타자 수 초과) }
  function importRecordText(base, text) {
    let obj;
    try {
      obj = JSON.parse(String(text || '').trim());
    } catch (e) {
      return { error: 'parse' };
    }
    const valid = validateRecord(obj);
    if (!valid) return { error: 'invalid' };
    const before = normalizeRecord(base);
    const record = mergeRecords(before, valid);
    const added = [];
    const updated = [];
    const skipped = [];
    for (const [key, p] of Object.entries(valid.players)) {
      if (!before.players[key]) (record.players[key] ? added : skipped).push(p.name);
      else if (JSON.stringify(before.players[key]) !== JSON.stringify(record.players[key])) updated.push(p.name);
    }
    return { record, added, updated, skipped };
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
    normalizeName, playerKey, defaultPlayer, defaultRecord, normalizeRecord, validateRecord,
    ensurePlayer, careerAvg, rankPlayers, deletePlayer, applyGameResult, mergeRecords,
    exportRecord, importRecordText,
    storage: { load, save, clear },
  };
  if (isNode) module.exports = api;
  else Object.assign((global.BB = global.BB || {}), api);
})(typeof window !== 'undefined' ? window : globalThis);
