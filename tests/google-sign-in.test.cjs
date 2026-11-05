const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const file = path.join(__dirname, '../lib/cloud.ts');
const ast = ts.createSourceFile('cloud.ts', fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function find(node, predicate) {
  if (predicate(node)) return node;
  let found;
  ts.forEachChild(node, child => { found ||= find(child, predicate); });
  return found;
}
const prop = (objectLiteral, name) => objectLiteral.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === name);

const signIn = find(ast, n => ts.isFunctionDeclaration(n) && n.name?.text === 'signInWithGoogle');
const oauthCall = signIn && find(signIn, n => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'signInWithOAuth');

test('signInWithGoogle calls signInWithOAuth with a single options object', () => {
  assert.ok(signIn, 'signInWithGoogle is exported from lib/cloud.ts');
  assert.ok(oauthCall, 'signInWithGoogle calls auth.signInWithOAuth');
  assert.equal(oauthCall.arguments.length, 1);
  assert.ok(ts.isObjectLiteralExpression(oauthCall.arguments[0]));
});

test('Google OAuth always shows the account picker', () => {
  const args = oauthCall.arguments[0];
  assert.equal(prop(args, 'provider')?.initializer.getText(ast), '"google"');
  const options = prop(args, 'options')?.initializer;
  assert.ok(options && ts.isObjectLiteralExpression(options), 'options is an object literal');
  const queryParams = prop(options, 'queryParams')?.initializer;
  assert.ok(queryParams && ts.isObjectLiteralExpression(queryParams), 'queryParams is an object literal');
  assert.equal(prop(queryParams, 'prompt')?.initializer.getText(ast), '"select_account"');
});

test('OAuth return address is unchanged (no Supabase redirect allow-list change needed)', () => {
  const options = prop(oauthCall.arguments[0], 'options').initializer;
  assert.equal(prop(options, 'redirectTo')?.initializer.getText(ast), 'window.location.origin + "/"');
});
