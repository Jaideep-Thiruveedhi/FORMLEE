import assert from 'node:assert/strict'
import test from 'node:test'
import './support/register-ts-alias-loader.mjs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { resolveAgentProvider, validateOpenRouterModel } = await import(pathToFileURL(path.join(ROOT, 'src/lib/agent/provider-config.ts')).href)
const { sanitizeModelMessages } = await import(pathToFileURL(path.join(ROOT, 'src/lib/agent/model-privacy.ts')).href)
const { requestOpenRouter } = await import(pathToFileURL(path.join(ROOT, 'src/lib/agent/openrouter.ts')).href)
const { parsePlanJson } = await import(pathToFileURL(path.join(ROOT, 'src/lib/agent/tasks/plan-parser.ts')).href)

const envKeys = ['NODE_ENV', 'AGENT_MODEL_PROVIDER', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OLLAMA_MODEL']
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalConsoleInfo = console.info
const originalConsoleWarn = console.warn
console.info = () => {}
console.warn = () => {}

function setProvider(overrides = {}) {
  for (const key of envKeys) delete process.env[key]
  Object.assign(process.env, { NODE_ENV: 'test', AGENT_MODEL_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-only-secret', OPENROUTER_MODEL: 'example/test-model', ...overrides })
}

function mockResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

async function callAgentModel({ messages, tools = [], sensitiveValues = [], signal } = {}) {
  try {
    const config = resolveAgentProvider()
    if (config.provider !== 'openrouter') throw new Error('unexpected test provider')
    const safeMessages = sanitizeModelMessages(messages, sensitiveValues)
    return { ...(await requestOpenRouter({ messages: safeMessages, tools, model: config.model, apiKey: config.apiKey, signal })), nativeToolSupport: true }
  } catch (error) {
    return { ok: false, text: null, toolCalls: [], nativeToolSupport: false, error: error.message }
  }
}

test.after(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
  globalThis.fetch = originalFetch
  console.info = originalConsoleInfo
  console.warn = originalConsoleWarn
})

test('provider selection defaults to Ollama in development and production requires OpenRouter', () => {
  assert.equal(resolveAgentProvider({ NODE_ENV: 'development' }).provider, 'ollama')
  assert.equal(resolveAgentProvider({ NODE_ENV: 'development', AGENT_MODEL_PROVIDER: 'ollama' }).provider, 'ollama')
  assert.equal(resolveAgentProvider({ NODE_ENV: 'development', AGENT_MODEL_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'vendor/model' }).provider, 'openrouter')
  assert.throws(() => resolveAgentProvider({ NODE_ENV: 'production', AGENT_MODEL_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://localhost' }), /Production requires/)
})

test('OpenRouter requires a key and an explicit safe model identifier', () => {
  assert.throws(() => resolveAgentProvider({ NODE_ENV: 'development', AGENT_MODEL_PROVIDER: 'openrouter', OPENROUTER_MODEL: 'vendor/model' }), /API_KEY is required/)
  assert.throws(() => resolveAgentProvider({ NODE_ENV: 'development', AGENT_MODEL_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k' }), /OPENROUTER_MODEL/)
  for (const model of ['openrouter/auto', 'vendor', '../model', 'vendor/model with spaces']) assert.throws(() => validateOpenRouterModel(model))
  assert.equal(validateOpenRouterModel('vendor/model-name'), 'vendor/model-name')
})

test('production configuration requires server-side OpenRouter values and validates model shape', async () => {
  const { validateProductionEnvironment } = await import('../../src/lib/server-env.mjs')
  const base = {
    NODE_ENV: 'production', DATABASE_URL: 'postgresql://a:b@db.example.invalid:5432/formlee?sslmode=require',
    DIRECT_DATABASE_URL: 'postgresql://a:b@db.example.invalid:5432/formlee?sslmode=require',
    BETTER_AUTH_SECRET: 'x'.repeat(48), BETTER_AUTH_URL: 'https://formlee.example.invalid',
    DOCUMENT_STORAGE_PROVIDER: 'local', FORMLEE_STORAGE_DIR: '/var/lib/formlee/uploads',
    AGENT_MODEL_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: 'vendor/model',
  }
  assert.doesNotThrow(() => validateProductionEnvironment(base))
  assert.throws(() => validateProductionEnvironment({ ...base, OPENROUTER_API_KEY: '' }), /OPENROUTER_API_KEY/)
  assert.throws(() => validateProductionEnvironment({ ...base, OPENROUTER_MODEL: 'openrouter/auto' }), /explicit provider\/model/)
  assert.throws(() => validateProductionEnvironment({ ...base, AGENT_MODEL_PROVIDER: 'ollama' }), /must be openrouter/)
})

test('successful OpenRouter completion parses structured tool calls and safe usage metadata', async () => {
  setProvider()
  let posted
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.equal(init.headers.Authorization, 'Bearer test-only-secret')
    posted = JSON.parse(init.body)
    return mockResponse(200, {
      id: 'req_123', provider: 'deepseek', usage: { prompt_tokens: 21, completion_tokens: 9 },
      choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call_1', function: { name: 'get_student_profile_summary', arguments: '{}' } }] } }],
    })
  }
  const result = await callAgentModel({ messages: [{ role: 'user', content: 'Summarize my profile' }], tools: [] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.toolCalls[0], { id: 'call_1', name: 'get_student_profile_summary', arguments: {} })
  assert.equal(result.finishReason, 'tool_calls')
  assert.deepEqual(result.usage, { provider: 'openrouter', model: 'example/test-model', inputTokens: 21, outputTokens: 9, requestId: 'req_123' })
  assert.equal(posted.max_tokens, 1024)
  assert.equal(posted.stream, false)
})

test('ordinary agent requests serialize OpenAI-compatible function tools without changing default tool choice', async () => {
  setProvider()
  let posted
  globalThis.fetch = async (_url, init) => {
    posted = JSON.parse(init.body)
    return mockResponse(200, { choices: [{ finish_reason: 'stop', message: { content: 'done' } }] })
  }
  const config = resolveAgentProvider()
  const tools = [{ type: 'function', function: { name: 'read_profile', description: 'Read profile.', parameters: { type: 'object', properties: {} } } }]
  await requestOpenRouter({ messages: [{ role: 'user', content: 'summarize' }], tools, model: config.model, apiKey: config.apiKey })
  assert.deepEqual(posted.tools, tools)
  assert.equal(Object.hasOwn(posted, 'tool_choice'), false, 'OpenRouter uses its documented default auto choice')
  assert.equal(posted.stream, false)
})

test('normal assistant text follows the non-streaming chat-completions envelope', async () => {
  setProvider()
  globalThis.fetch = async () => mockResponse(200, {
    id: 'chatcmpl_text_1', provider: 'deepseek',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello.' } }],
  })
  const result = await callAgentModel({ messages: [{ role: 'user', content: 'hello' }], tools: [] })
  assert.equal(result.ok, true)
  assert.equal(result.text, 'Hello.')
  assert.deepEqual(result.toolCalls, [])
  assert.equal(result.finishReason, 'stop')
})

test('task planning sends JSON mode without native tool definitions and parses the JSON content', async () => {
  setProvider()
  let posted
  const planJson = JSON.stringify({ explanation: 'Read the profile.', steps: [{ toolName: 'get_student_profile_summary', description: 'Read saved profile summary.', args: {} }] })
  globalThis.fetch = async (_url, init) => {
    posted = JSON.parse(init.body)
    return mockResponse(200, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: planJson } }] })
  }
  const config = resolveAgentProvider()
  const result = await requestOpenRouter({
    messages: [{ role: 'system', content: 'Return one JSON object.' }, { role: 'user', content: 'Prepare my form.' }],
    tools: [], responseFormat: { type: 'json_object' }, model: config.model, apiKey: config.apiKey,
  })
  assert.equal(result.ok, true)
  assert.equal(posted.response_format.type, 'json_object')
  assert.equal(Object.hasOwn(posted, 'tools'), false, 'planning does not offer native tool calls')
  assert.equal(parsePlanJson(result.text).success, true)
  const plannerSource = await (await import('node:fs/promises')).readFile(path.join(ROOT, 'src/lib/agent/tasks/planner.ts'), 'utf8')
  assert.match(plannerSource, /tools: \[\]/)
  assert.match(plannerSource, /responseFormat: \{ type: 'json_object' \}/)
})

test('malformed plan JSON is rejected by the plan parser instead of treated as a plan', () => {
  assert.deepEqual(parsePlanJson('{"explanation":,"steps":[]}'), { success: false })
  assert.deepEqual(parsePlanJson('not-json'), { success: false })
})

test('an empty OpenRouter completion fails with a specific safe error', async () => {
  setProvider()
  globalThis.fetch = async () => mockResponse(200, { id: 'empty_1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: null } }] })
  const result = await callAgentModel({ messages: [{ role: 'user', content: 'hello' }], tools: [] })
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'EMPTY_RESPONSE')
  assert.match(result.error, /empty completion/)
})

test('reasoning-only output is not mistaken for the assistant completion', async () => {
  setProvider()
  globalThis.fetch = async () => mockResponse(200, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: null, reasoning: 'PRIVATE_REASONING' } }] })
  const result = await callAgentModel({ messages: [{ role: 'user', content: 'hello' }], tools: [] })
  assert.equal(result.errorCode, 'EMPTY_RESPONSE')
  assert.doesNotMatch(result.error, /PRIVATE_REASONING/)
})

test('malformed tool-call JSON is rejected rather than converted into empty arguments', async () => {
  setProvider()
  globalThis.fetch = async () => mockResponse(200, {
    choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call_bad', function: { name: 'read_profile', arguments: '{bad-json' } }] } }],
  })
  const result = await callAgentModel({ messages: [{ role: 'user', content: 'hello' }], tools: [] })
  assert.equal(result.errorCode, 'MALFORMED_TOOL_ARGUMENTS')
  assert.match(result.error, /malformed tool arguments/)
})

test('refusal responses fail safely without exposing the refusal body in diagnostics', async () => {
  setProvider()
  globalThis.fetch = async () => mockResponse(200, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: null, refusal: 'PRIVATE_REFUSAL_TEXT' } }] })
  const result = await callAgentModel({ messages: [{ role: 'user', content: 'hello' }], tools: [] })
  assert.equal(result.errorCode, 'MODEL_REFUSAL')
  assert.match(result.error, /refused/)
  assert.doesNotMatch(result.error, /PRIVATE_REFUSAL_TEXT/)
})

test('provider error bodies use safe codes and never echo provider messages', async () => {
  setProvider()
  let diagnostic
  const originalWarn = console.warn
  console.warn = (_label, metadata) => { diagnostic = metadata }
  try {
    globalThis.fetch = async () => mockResponse(400, { error: { code: 'model_not_found', message: 'PRIVATE_PROVIDER_ERROR' } })
    const result = await callAgentModel({ messages: [{ role: 'user', content: 'PRIVATE_PROMPT' }], tools: [] })
    assert.equal(result.errorCode, 'model_not_found')
    assert.match(result.error, /model_not_found/)
    assert.doesNotMatch(result.error, /PRIVATE_PROVIDER_ERROR|PRIVATE_PROMPT/)
    assert.equal(diagnostic.httpStatus, 400)
    assert.equal(diagnostic.errorCode, 'model_not_found')
  } finally {
    console.warn = originalWarn
  }
})

test('truncated completions are rejected before partial JSON can be used', async () => {
  setProvider()
  globalThis.fetch = async () => mockResponse(200, { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '{"explanation":' } }] })
  const result = await callAgentModel({ messages: [{ role: 'user', content: 'hello' }], tools: [] })
  assert.equal(result.errorCode, 'OUTPUT_TRUNCATED')
  assert.match(result.error, /truncated/)
  assert.equal(result.finishReason, 'length')
})

test('unexpected response structures are classified without logging response contents', async t => {
  setProvider()
  const cases = [
    ['empty choices', { id: 'no_choices', choices: [] }, 'NO_CHOICES'],
    ['content array', { id: 'array_content', choices: [{ message: { content: [{ type: 'text', text: 'do not log' }] } }] }, 'UNSUPPORTED_CONTENT_TYPE'],
    ['non-array tool_calls', { id: 'bad_calls', choices: [{ message: { content: null, tool_calls: {} } }] }, 'MALFORMED_TOOL_CALLS'],
    ['invalid JSON body', null, 'INVALID_JSON'],
  ]
  for (const [name, body, expectedCode] of cases) {
    await t.test(name, async () => {
      let diagnostic
      const originalWarn = console.warn
      console.warn = (_label, metadata) => { diagnostic = metadata }
      try {
        globalThis.fetch = async () => body === null
          ? new Response('not-json', { status: 200 })
          : mockResponse(200, body)
        const result = await callAgentModel({ messages: [{ role: 'user', content: 'PRIVATE_PROMPT' }], tools: [] })
        assert.equal(result.ok, false)
        assert.equal(result.errorCode, expectedCode)
        assert.equal(diagnostic.errorCode, expectedCode)
        assert.equal(JSON.stringify(diagnostic).includes('PRIVATE_PROMPT'), false)
      } finally {
        console.warn = originalWarn
      }
    })
  }
})

test('safe provider diagnostics contain only allowed metadata, never keys, prompts or model output', async () => {
  setProvider()
  let diagnostic
  const originalInfo = console.info
  console.info = (_label, metadata) => { diagnostic = metadata }
  try {
    globalThis.fetch = async () => mockResponse(200, {
      id: 'chatcmpl_safe_1', provider: 'deepseek',
      choices: [{ finish_reason: 'stop', message: { content: 'PRIVATE_MODEL_OUTPUT' } }],
    })
    const config = resolveAgentProvider()
    await requestOpenRouter({ messages: [{ role: 'user', content: 'PRIVATE_PROMPT' }], tools: [], model: config.model, apiKey: 'PRIVATE_API_KEY' })
    assert.deepEqual(Object.keys(diagnostic).sort(), ['contentExists', 'contentType', 'finishReason', 'httpStatus', 'model', 'providerId', 'responseId', 'toolCallCount'].sort())
    const serialized = JSON.stringify(diagnostic)
    assert.doesNotMatch(serialized, /PRIVATE_MODEL_OUTPUT|PRIVATE_PROMPT|PRIVATE_API_KEY/)
    assert.equal(diagnostic.httpStatus, 200)
    assert.equal(diagnostic.providerId, 'deepseek')
    assert.equal(diagnostic.finishReason, 'stop')
    assert.equal(diagnostic.contentExists, true)
    assert.equal(diagnostic.contentType, 'string')
    assert.equal(diagnostic.toolCallCount, 0)
  } finally {
    console.info = originalInfo
  }
})

test('known student values and common contact data are removed before the provider request', async () => {
  setProvider()
  let sent = ''
  globalThis.fetch = async (_url, init) => {
    sent = init.body
    return mockResponse(200, { choices: [{ message: { content: 'ok' } }] })
  }
  const result = await callAgentModel({
    messages: [{ role: 'user', content: 'My name is Asha Rao. Email asha@example.test, phone +91 98765 43210; password=hunter2' }],
    sensitiveValues: ['Asha Rao'], tools: [],
  })
  assert.equal(result.ok, true)
  assert.doesNotMatch(sent, /Asha Rao|asha@example\.test|98765 43210|hunter2/)
  assert.match(sent, /REDACTED/)
})

test('JSON tool output strips sensitive fields from stale snapshots by key', async () => {
  setProvider()
  let sent = ''
  globalThis.fetch = async (_url, init) => { sent = init.body; return mockResponse(200, { choices: [{ message: { content: 'ok' } }] }) }
  await callAgentModel({ messages: [{ role: 'tool', tool_call_id: 'tool-1', content: JSON.stringify({ ok: true, data: { profileSnapshot: { fullName: 'Stale Student', dateOfBirth: '2004-02-03' }, status: 'READY' } }) }], tools: [] })
  assert.doesNotMatch(sent, /Stale Student|2004-02-03/)
  assert.match(sent, /READY/)
})

test('provider auth, billing and rate-limit errors are generic and do not retry', async t => {
  setProvider()
  for (const [status, expected] of [[401, /authentication failed/], [402, /billing and limits/], [429, /rate limiting/]]) {
    await t.test(String(status), async () => {
      let calls = 0
      globalThis.fetch = async () => { calls++; return mockResponse(status, { error: { message: 'secret provider internals' } }) }
      const result = await callAgentModel({ messages: [{ role: 'user', content: 'hello' }], tools: [] })
      assert.equal(calls, 1)
      assert.equal(result.ok, false)
      assert.match(result.error, expected)
      assert.doesNotMatch(result.error, /secret provider internals/)
    })
  }
})

test('timeout and malformed provider responses fail safely without local fallback', async () => {
  setProvider()
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), { once: true }))
  }
  const config = resolveAgentProvider()
  const timedOut = await requestOpenRouter({ messages: [{ role: 'user', content: 'hello' }], tools: [], model: config.model, apiKey: config.apiKey, timeoutMs: 10 })
  assert.equal(timedOut.ok, false)
  assert.match(timedOut.error, /timed out/)
  assert.equal(calls, 1)

  globalThis.fetch = async () => { calls++; return mockResponse(200, { choices: [] }) }
  const malformed = await callAgentModel({ messages: [{ role: 'user', content: 'hello' }], tools: [] })
  assert.equal(malformed.ok, false)
  assert.equal(malformed.errorCode, 'NO_CHOICES')
  assert.match(malformed.error, /no completion choices/)
  assert.equal(calls, 2)
})

test('size guard prevents oversized input from reaching provider', async () => {
  setProvider()
  let calls = 0
  globalThis.fetch = async () => { calls++; return mockResponse(200, {}) }
  const result = await callAgentModel({ messages: [{ role: 'user', content: 'x'.repeat(25000) }], tools: [] })
  assert.equal(result.ok, false)
  assert.match(result.error, /size limit/)
  assert.equal(calls, 0)
})

test('agent still requires explicit student approval before fill actions', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(path.join(ROOT, 'src/lib/agent/runner.ts'), 'utf8')
  assert.match(source, /isStudentActionTool\(tc\.name\)/)
  assert.match(source, /STUDENT_ACTION_REQUIRED/)
})

test('hosted task planning does not retry malformed output and incur repeated requests', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(path.join(ROOT, 'src/lib/agent/tasks/planner.ts'), 'utf8')
  assert.match(source, /const hostedProvider = process\.env\.NODE_ENV === 'production'/)
  assert.match(source, /const maxAttempts = hostedProvider \? 1 : DEFAULT_TASK_LIMITS\.maxPlanningIterations/)
})
