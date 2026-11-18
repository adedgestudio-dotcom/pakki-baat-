const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = fs.readFileSync('app/workspace.tsx', 'utf8');
const start = source.indexOf('{notificationPermission === "default" && !permissionPromptDismissed && (');
const end = source.indexOf('{signedOutCard(', start);
const jsx = source.slice(start, end);
const code = ts.transpileModule(`module.exports = (notificationPermission, permissionPromptDismissed) => <>${jsx}</>`, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sandbox = { module: { exports: {} }, React, requestReminderPermission() {}, dismissPermissionPrompt() {} };
vm.runInNewContext(code, sandbox);
const render = (permission, dismissed = false) => renderToStaticMarkup(sandbox.module.exports(permission, dismissed));

test('permission banner is limited to default permission and disappears when dismissed', () => {
  assert.match(render('default'), /Turn on notifications.*Allow/);
  assert.doesNotMatch(render('default', true), /Turn on notifications/);
  assert.doesNotMatch(render('granted'), /Turn on notifications|Notifications are blocked/);
  assert.doesNotMatch(render('unsupported'), /Turn on notifications|Notifications are blocked/);
  assert.match(render('denied'), /Notifications are blocked/);
  assert.doesNotMatch(render('denied'), /<button/);
});

test('prompt is on the Reminders page and refreshes permission after returning to the app', () => {
  assert.ok(start > source.indexOf('{tab === "Reminders" && ('));
  assert.ok(end < source.indexOf('<section className="reminder-page-summary">', start));
  assert.match(source, /sessionStorage\.setItem\("reminder-permission-prompt-dismissed", "1"\)/);
  assert.match(source, /window\.addEventListener\("focus", refreshPermission\)/);
  assert.match(source, /setNotificationPermission\(await Notification\.requestPermission\(\)\)/);
});
