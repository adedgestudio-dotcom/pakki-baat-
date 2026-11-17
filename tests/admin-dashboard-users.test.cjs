const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

test('dashboard returns one row per auth id even with duplicate auth responses and subscription ids', async () => {
  const source = ts.transpileModule(fs.readFileSync('app/api/admin/dashboard/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }, urls = [];
  const fetch = async url => {
    urls.push(url);
    if (url.includes('/auth/v1/admin/users')) return Response.json({ users: [{ id: 'auth-a', email: 'a@example.test' }, { id: 'auth-a', email: 'a@example.test' }, { id: 'auth-b', email: 'b@example.test' }] });
    if (url.includes('/subscriptions?')) return Response.json([{ id: 'subscription-id', owner_id: 'auth-a', plan: 'trial', status: 'active' }]);
    return Response.json([]);
  };
  vm.runInNewContext(source, { module, exports: module.exports, fetch, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test' } }, require: name => name === 'next/server' ? { NextResponse: { json: (body, init) => Response.json(body, init) } } : name === '@/lib/admin-auth' ? { isAdmin: () => true } : require(name) });
  const response = await module.exports.GET({});
  const body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body.users.map(user => user.id), ['auth-a', 'auth-b']);
  assert.equal(new Set(body.users.map(user => user.id)).size, body.users.length);
  assert.equal(body.stats.totalUsers, 2);
  assert.equal(urls.filter(url => url.includes('/auth/v1/admin/users')).length, 1);
});
