const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/groq-retry.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(compiled, { module: mod, exports: mod.exports, console: { warn() {} } });
const { withJsonValidationRetry, isJsonValidationText, ASSISTANT_HICCUP_MESSAGE } = mod.exports;

const groqJsonFailure = () =>
  new Response(JSON.stringify({ error: { message: 'Failed to validate JSON. Please adjust your prompt.', type: 'invalid_request_error', code: 'json_validate_failed' } }), { status: 400 });
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"extracted":{}}' } }] }), { status: 200 });

function sequence(...responses) {
  let calls = 0;
  const request = async () => responses[Math.min(calls++, responses.length - 1)]();
  return { request, calls: () => calls };
}

test('json_validate_failed is retried once and the second answer is used', async () => {
  const s = sequence(groqJsonFailure, ok);
  const response = await withJsonValidationRetry(s.request);
  assert.equal(s.calls(), 2);
  assert.equal(response.status, 200);
});

test('a second json_validate_failed is returned after exactly one retry', async () => {
  const s = sequence(groqJsonFailure, groqJsonFailure, ok);
  const response = await withJsonValidationRetry(s.request);
  assert.equal(s.calls(), 2);
  assert.equal(response.status, 400);
  assert.equal(isJsonValidationText(response.status, await response.text()), true);
});

test('other 400 errors are not retried and their body stays readable', async () => {
  const s = sequence(() => new Response('{"error":{"message":"model not found","code":"model_not_found"}}', { status: 400 }), ok);
  const response = await withJsonValidationRetry(s.request);
  assert.equal(s.calls(), 1);
  assert.match(await response.text(), /model_not_found/);
});

test('success and 5xx answers are not retried here', async () => {
  for (const make of [ok, () => new Response('upstream down', { status: 503 })]) {
    const s = sequence(make, ok);
    await withJsonValidationRetry(s.request);
    assert.equal(s.calls(), 1);
  }
});

test('detection matches the error code or the message, only on HTTP 400', () => {
  assert.equal(isJsonValidationText(400, '{"error":{"code":"json_validate_failed"}}'), true);
  assert.equal(isJsonValidationText(400, '{"error":{"message":"Failed to validate JSON"}}'), true);
  assert.equal(isJsonValidationText(400, '{"error":{"message":"Invalid API key"}}'), false);
  assert.equal(isJsonValidationText(500, 'json_validate_failed'), false);
});

test('process-message retries via the helper and hides the raw Groq text', () => {
  const route = fs.readFileSync(path.join(__dirname, '../app/api/process-message/route.ts'), 'utf8');
  assert.match(route, /await withJsonValidationRetry\(\(\) =>\s*fetch\(/);
  const condition = route.indexOf('if (isJsonValidationText(response.status, upstream))');
  assert.ok(condition > 0, 'json validation branch exists');
  const returnStart = route.indexOf('return NextResponse.json(', condition);
  const returned = route.slice(returnStart, route.indexOf(');', returnStart) + 2);
  assert.match(returned, /error: ASSISTANT_HICCUP_MESSAGE/);
  assert.match(returned, /retryable: true/);
  assert.match(returned, /status: 502/);
  assert.doesNotMatch(returned, /upstream\b(?!Status)/, 'raw upstream text is not returned');
  assert.equal(ASSISTANT_HICCUP_MESSAGE, 'The assistant had a hiccup. Please try again.');
});
