export const DEFAULT_MODEL = 'deepseek-flash';
const MODELS = new Set(['deepseek-flash', 'deepseek-v4-pro']);

export function pageKeyAllowed({ protocol, hostname }) {
  return protocol === 'https:' || ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
}

// Pure in-memory state. Never writes localStorage, sessionStorage, cookies or
// a file. Exporting learning records cannot accidentally serialize this state.
export function createModelSession() {
  let active = { source: 'session', model: DEFAULT_MODEL, apiKey: '' };
  return {
    apply({ source = 'session', model = DEFAULT_MODEL, apiKey = '' }) {
      if (source !== 'session') throw new Error('请在页面输入 API Key。');
      if (!MODELS.has(model)) throw new Error('请选择可用的模型。');
      if (typeof apiKey !== 'string') throw new Error('API Key 格式不正确。');
      const key = apiKey.trim() || active.apiKey;
      if (!key) throw new Error('请输入 API Key。');
      if (key.length > 512 || /[^\x21-\x7e]/.test(key)) throw new Error('API Key 格式不正确，请检查空格或换行。');
      active = { source: 'session', model, apiKey: key };
      return this.summary();
    },
    clear() { active = { source: 'session', model: active.model, apiKey: '' }; },
    canCall() { return Boolean(active.apiKey); },
    summary() { return { source: active.source, model: active.model, hasSessionKey: Boolean(active.apiKey) }; },
    requestSettings() {
      return { source: 'session', model: active.model, apiKey: active.apiKey };
    }
  };
}
