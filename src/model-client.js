export const DEFAULT_MODEL = 'deepseek-flash';
export const MODEL_OPTIONS = [
  { id: 'deepseek-flash', label: 'DeepSeek Flash（默认）' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }
];
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

function fail(message, code, status = 400, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}

// Request credentials are returned only to the calling stack. They are never
// assigned to process.env, persisted, logged, or included in response objects.
export function resolveModelConfig(settings) {
  if (settings !== undefined && (!settings || typeof settings !== 'object' || Array.isArray(settings))) {
    throw fail('API 设置格式不正确。', 'MODEL_SETTINGS_INVALID');
  }
  const source = settings?.source ?? 'session';
  if (source !== 'session') throw fail('已停用服务器密钥，请在页面输入 API Key。', 'MODEL_SOURCE_INVALID');
  if (settings && ('baseUrl' in settings || 'baseURL' in settings)) throw fail('页面密钥仅发送到 DeepSeek 官方接口，不接受自定义地址。', 'MODEL_ENDPOINT_INVALID');
  const model = settings?.model ?? DEFAULT_MODEL;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,99}$/.test(model)) throw fail('模型名称格式不正确。', 'MODEL_NAME_INVALID');
  const key = settings?.apiKey;
  if (typeof key !== 'string' || !key.trim()) {
    throw fail('请在页面输入 API Key，再应用设置或测试连接。', 'MODEL_KEY_REQUIRED');
  }
  const apiKey = key.trim();
  if (apiKey.length > 512 || /[^\x21-\x7e]/.test(apiKey)) throw fail('API Key 格式不正确，请检查空格或换行。', 'MODEL_KEY_INVALID');
  const base = new URL(DEEPSEEK_BASE_URL);
  return { source, apiKey, model, base };
}

export function buildCompletionBody(config, messages, maxTokens = 1024) {
  return {
    model: config.model, messages, temperature: 0.2, max_tokens: maxTokens,
    stream: false, response_format: { type: 'json_object' },
    ...(config.base.hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' } } : {})
  };
}

function upstreamError(status) {
  const messages = {
    400: '模型请求被拒绝，请检查所选模型是否支持当前接口。',
    401: 'API Key 无效、已过期或没有访问权限，请重新填写。',
    402: 'API 账户余额不足，请到服务商控制台检查余额。',
    403: '当前 API Key 无权访问此模型，请检查账户权限。',
    404: '模型或接口不存在，请检查模型选择和服务器配置。',
    408: '模型服务响应超时，请稍后重试。',
    429: '模型服务限流，请稍后重试。'
  };
  return fail(messages[status] || `模型服务暂时不可用（HTTP ${status}），请稍后重试。`, `MODEL_HTTP_${status}`, status === 429 ? 429 : 502, { upstreamStatus: status });
}

export async function requestCompletion(config, body, fetchImpl = fetch, timeoutMs = 35000) {
  let response;
  try {
    response = await fetchImpl(`${config.base.href.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (['AbortError', 'TimeoutError'].includes(error?.name)) throw fail('模型调用超时，请稍后重试；教案仍然可用。', 'MODEL_TIMEOUT', 504);
    throw fail('无法连接模型服务，请检查网络后重试；教案仍然可用。', 'MODEL_NETWORK', 502);
  }
  // Never return provider error bodies: some gateways echo request credentials.
  if (!response.ok) throw upstreamError(response.status);
  try { return await response.json(); }
  catch (error) {
    if (['AbortError', 'TimeoutError'].includes(error?.name)) throw fail('模型调用超时，请稍后重试；教案仍然可用。', 'MODEL_TIMEOUT', 504);
    throw fail('模型服务返回了无效数据，请重试。', 'MODEL_RESPONSE_INVALID', 502);
  }
}

export async function testModelConnection(settings, fetchImpl = fetch) {
  const config = resolveModelConfig(settings);
  const started = Date.now();
  const messages = [
    { role: 'system', content: '你正在进行接口连接测试，请只回复 OK。' },
    { role: 'user', content: '测试连接。' }
  ];
  // Connectivity is not a structured-answer quality test. Requiring JSON here
  // can mislabel a working model as disconnected. Actual coach output retains
  // its independent, strict JSON/move/citation checks.
  const body = { ...buildCompletionBody(config, messages, 64), response_format: { type: 'text' } };
  const payload = await requestCompletion(config, body, fetchImpl, 12000);
  const answer = payload.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim() || payload.choices?.[0]?.finish_reason === 'length') throw fail('模型已响应，但连接测试返回内容为空或被截断。', 'MODEL_RESPONSE_INVALID', 502);
  return { ok: true, model: config.model, source: config.source, elapsedMs: Date.now() - started, message: `连接成功：${config.model} 已正常返回测试响应。` };
}
