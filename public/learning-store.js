import { recordAttempt } from './curriculum.js';

export function sanitizeLearningRecords(raw, ids) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('记录结构不正确。');
  const result = {};
  for (const id of ids) {
    const record = raw[id];
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const count = value => Number.isInteger(value) && value >= 0 ? Math.min(value, 100000) : 0;
    result[id] = { attempts: count(record.attempts), mistakes: count(record.mistakes), completed: record.completed === true, independent: record.independent === true, resolved: record.resolved === true, lastSeen: typeof record.lastSeen === 'string' && !Number.isNaN(Date.parse(record.lastSeen)) ? record.lastSeen.slice(0, 30) : null };
  }
  return result;
}

// Read-modify-write happens inside ONE native readwrite transaction. The
// database, not a tab's cached snapshot, serializes writers across tabs.
// Only learning fields are stored; keys, model responses and tokens are not.
export function createLearningStore({ ids, factory = globalThis.indexedDB }) {
  if (!factory) throw new Error('浏览器不支持本地事务存储。');
  const allowed = new Set(ids);
  const opened = new Promise((resolve, reject) => {
    let failed = false;
    const request = factory.open('qili-learning-v2', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('records', { keyPath: 'id' });
      request.result.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onerror = () => { failed = true; reject(request.error || new Error('本地学习数据库无法打开。')); };
    request.onblocked = () => { failed = true; reject(new Error('学习数据库被其他旧页面占用，请刷新其他页面。')); };
    request.onsuccess = () => {
      const db = request.result;
      if (failed) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
  async function transaction(names, mode, action) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('学习记录保存失败，事务未提交。'));
      tx.onerror = () => {}; // The abort handler reports the final outcome.
      try { action(tx, value => { result = value; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  return {
    async initialize(legacy = {}) {
      const records = sanitizeLearningRecords(legacy, ids);
      return transaction(['records', 'meta'], 'readwrite', (tx, result) => {
        const marker = tx.objectStore('meta').get('legacy-imported');
        marker.onsuccess = () => {
          if (marker.result) { result(false); return; }
          for (const [id, record] of Object.entries(records)) tx.objectStore('records').put({ id, ...record });
          tx.objectStore('meta').put({ key: 'legacy-imported', value: true });
          result(true);
        };
      });
    },
    async readAll() {
      return transaction('records', 'readonly', (tx, result) => {
        const request = tx.objectStore('records').getAll();
        request.onsuccess = () => result(sanitizeLearningRecords(Object.fromEntries(request.result.map(record => [record.id, record])), ids));
      });
    },
    async attempt(id, report, assisted, now = new Date().toISOString()) {
      if (!allowed.has(id)) throw new Error('题目不存在。');
      return transaction('records', 'readwrite', tx => {
        const records = tx.objectStore('records'), previous = records.get(id);
        previous.onsuccess = () => {
          const safe = sanitizeLearningRecords({ [id]: previous.result }, ids)[id];
          records.put({ id, ...recordAttempt(safe, { correct: report.correct === true, complete: report.complete ?? report.correct === true }, assisted === true, now) });
        };
      });
    },
    async importRecords(raw) {
      const records = sanitizeLearningRecords(raw, ids);
      return transaction('records', 'readwrite', tx => {
        for (const [id, record] of Object.entries(records)) tx.objectStore('records').put({ id, ...record });
      });
    }
  };
}
