import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export function browserConfiguration(environment) {
  const required = ['TRIPSIT_LIVE_ORIGIN', 'TRIPSIT_LIVE_OWNER_COOKIE', 'TRIPSIT_LIVE_OTHER_COOKIE', 'TRIPSIT_LIVE_REPOSITORY', 'TRIPSIT_LIVE_ISSUE_NUMBER'];
  if (required.some(name => !environment[name])) throw new Error('Missing authenticated browser UAT configuration.');
  const url = new URL(environment.TRIPSIT_LIVE_ORIGIN);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Browser UAT requires an explicit local HTTP origin.');
  const repository = environment.TRIPSIT_LIVE_REPOSITORY;
  const issueNumber = Number(environment.TRIPSIT_LIVE_ISSUE_NUMBER);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) || ['.', '..'].includes(repository.split('/')[1]) || !/^[1-9]\d*$/.test(environment.TRIPSIT_LIVE_ISSUE_NUMBER) || !Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error('Invalid development issue fixture.');
  if (environment.TRIPSIT_LIVE_OWNER_COOKIE === environment.TRIPSIT_LIVE_OTHER_COOKIE) throw new Error('Two distinct real owner sessions are required.');
  browserCookies(environment.TRIPSIT_LIVE_OWNER_COOKIE, url.origin);
  browserCookies(environment.TRIPSIT_LIVE_OTHER_COOKIE, url.origin);
  return { origin: url.origin, repository, issueNumber, ownerCookie: environment.TRIPSIT_LIVE_OWNER_COOKIE, otherCookie: environment.TRIPSIT_LIVE_OTHER_COOKIE };
}

export function browserCookies(header, origin) {
  const names = new Set();
  return header.split(';').map(part => {
    const split = part.indexOf('=');
    const name = part.slice(0, split).trim();
    const value = part.slice(split + 1).trim();
    if (split < 1 || !/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\x00-\x20\x7f;]/.test(value) || !value || /^(path|domain|expires|max-age|secure|httponly|samesite)$/i.test(name) || names.has(name)) throw new Error('Invalid session cookie header.');
    names.add(name);
    return { name, value, url: origin, httpOnly: true, sameSite: 'Lax' };
  });
}

export async function chromeSession() {
  const profile = await mkdtemp(join(tmpdir(), 'tripsit-browser-'));
  const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let ended = false;
  const exited = new Promise(resolve => {
    chrome.once('exit', () => { ended = true; resolve(); });
    chrome.once('error', () => { ended = true; resolve(); });
  });
  const pending = new Map();
  let nextId = 0;
  let buffer = '';
  const fail = () => { for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('Chrome DevTools transport unavailable.')); } pending.clear(); };
  chrome.on('error', fail);
  chrome.on('exit', fail);
  chrome.stdio[3].on('error', fail);
  chrome.stdio[4].on('error', fail);
  chrome.stdio[4].on('data', chunk => {
    buffer += chunk.toString();
    if (buffer.length > 2 * 1024 * 1024) { fail(); chrome.kill('SIGTERM'); return; }
    for (let end; (end = buffer.indexOf('\0')) !== -1;) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error('Chrome DevTools command failed.'));
        else entry.resolve(message.result);
      }
    }
  });
  function command(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      if (chrome.exitCode !== null || chrome.stdio[3].destroyed) { reject(new Error('Chrome process is unavailable.')); return; }
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Browser check exceeded its deadline.')); }, 45_000);
      pending.set(id, { resolve, reject, timer });
      chrome.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`, error => { if (error) fail(); });
    });
  }
  return { command, close: async () => {
    const waitExit = async () => {
      let timer;
      try { await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 2000); })]); }
      finally { clearTimeout(timer); }
    };
    if (!ended) { chrome.kill('SIGTERM'); await waitExit(); }
    if (!ended) { chrome.kill('SIGKILL'); await waitExit(); }
    fail();
    if (!ended) throw new Error('Chrome did not terminate; cleanup is incomplete.');
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } };
}

export async function page(chrome, origin, cookie) {
  const context = await chrome.command('Target.createBrowserContext');
  const target = await chrome.command('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId });
  const attached = await chrome.command('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const command = (method, params) => chrome.command(method, params, attached.sessionId);
  await command('Network.enable');
  if (cookie) await command('Network.setCookies', { cookies: browserCookies(cookie, origin) });
  await command('Page.navigate', { url: origin });
  return async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('Browser UI assertion failed; inspect the development page without exporting source.');
    return result.result.value;
  };
}

export async function ownerFlow(repository, issueNumber, timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs;
  const waitFor = async predicate => { while (!predicate()) { if (Date.now() > deadline) throw new Error('UI deadline'); await new Promise(resolve => setTimeout(resolve, 100)); } };
  await waitFor(() => document.querySelector('#repository'));
  const section = document.querySelector('[aria-labelledby="issue-heading"]');
  const submit = section.querySelector('button[type="submit"]');
  const reload = [...section.querySelectorAll('button')].find(button => button.textContent === 'Reload my snapshots');
  const set = (selector, value) => { const input = document.querySelector(selector); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
  set('#repository', repository); set('#issue-number', issueNumber);
  await new Promise(resolve => setTimeout(resolve, 0));
  submit.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  await waitFor(() => !submit.disabled && (section.querySelector('h3') || section.querySelector('[role="alert"]')));
  if (section.querySelector('[role="alert"]')) throw new Error('UI create denied');
  const suppliedTitle = section.querySelector('h3').textContent;
  const sha = section.querySelector('code').textContent;
  if (!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) throw new Error('Missing frozen SHA');
  reload.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  await waitFor(() => !reload.disabled && section.querySelector('li button'));
  const chosen = [...section.querySelectorAll('li button')].find(button => button.textContent === `${repository} #${issueNumber}`);
  if (!chosen) throw new Error('Snapshot missing from owner list');
  const response = await fetch('/api/work-items', { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Owner API unavailable');
  const items = (await response.json()).items;
  const expected = items.find(item => item.snapshot.repository === repository && item.snapshot.issueNumber === issueNumber && item.snapshot.supplied.title === suppliedTitle);
  if (!expected) throw new Error('Created fixture identity missing');
  let snapshot;
  let detailFailed = false;
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const result = await originalFetch.apply(this, args);
    const request = args[0] instanceof Request ? args[0].url : String(args[0]);
    const target = new URL(request, location.href);
    if (target.origin === location.origin && target.pathname === `/api/work-items/${expected.id}`) {
      if (!result.ok) detailFailed = true;
      else {
        try {
          const observed = (await result.clone().json()).item;
          if (observed?.id !== expected.id) detailFailed = true;
          else snapshot = observed;
        } catch { detailFailed = true; }
      }
    }
    return result;
  };
  try {
    chosen.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await waitFor(() => detailFailed || (snapshot && !chosen.disabled && section.querySelector('h3')));
    if (detailFailed) throw new Error('Detail request failed');
  } finally { window.fetch = originalFetch; }
  if (!snapshot || section.querySelector('h3').textContent !== snapshot.snapshot.supplied.title || section.querySelector('.issue-body').textContent !== (snapshot.snapshot.supplied.body || 'No issue body supplied.')) throw new Error('Source rendering mismatch');
  if (section.querySelector('h3').childElementCount || section.querySelector('.issue-body').childElementCount) throw new Error('Issue markup executed');
  const text = section.textContent;
  if (!text.includes('Supplied issue text (unconfirmed)') || !text.includes('Inferred expectations: 0') || !text.includes('Owner-confirmed criteria: 0') || !text.includes('Snapshot expires')) throw new Error('Provenance or expiry absent');
  if (Date.parse(snapshot.expiresAt) <= Date.now()) throw new Error('Expired source exposed');
  const hostileFixture = /<(script|img|svg)\b/i.test(snapshot.snapshot.supplied.title + snapshot.snapshot.supplied.body);
  const signOut = [...document.querySelectorAll('button')].find(button => button.textContent === 'Sign out');
  signOut.click();
  await waitFor(() => !document.querySelector('#repository'));
  if (document.querySelector('.issue-body') || document.querySelector('h3')) throw new Error('Source retained after sign-out');
  return { itemId: snapshot.id, hostileFixture, created: true, reloaded: true, detail: true, escapedText: true, provenance: true, expiryDisplayed: true, signOutClearsSource: true };
}

async function otherFlow(itemId) {
  const deadline = Date.now() + 10_000;
  while (!document.querySelector('#repository')) { if (Date.now() > deadline) throw new Error('Second owner not authenticated'); await new Promise(resolve => setTimeout(resolve, 100)); }
  if (document.querySelector('.issue-body')) throw new Error('Prior owner source visible');
  const response = await fetch(`/api/work-items/${itemId}`, { signal: AbortSignal.timeout(10_000) });
  if (![403, 404].includes(response.status)) throw new Error('Second owner read not denied');
  const reload = [...document.querySelectorAll('[aria-labelledby="issue-heading"] button')].find(button => button.textContent === 'Reload my snapshots');
  reload.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  while (reload.disabled) { if (Date.now() > deadline) throw new Error('Second owner reload deadline'); await new Promise(resolve => setTimeout(resolve, 100)); }
  if (document.querySelector('.issue-body')) throw new Error('Prior owner source returned on reload');
  return { secondOwnerDenied: true, sourceAbsentAfterOwnerSwitch: true };
}

async function main() {
  const smoke = process.argv.includes('--browser-smoke');
  const config = smoke ? null : browserConfiguration(process.env);
  const chrome = await chromeSession();
  try {
    await chrome.command('Browser.getVersion');
    if (smoke) {
      const evaluate = await page(chrome, 'about:blank');
      if (await evaluate('1 + 1') !== 2) throw new Error('Browser evaluation unavailable.');
      return 'PASS: isolated headless Chrome DevTools transport, page evaluation and profile cleanup; no app or authentication checked.';
    }
    const evaluateOwner = await page(chrome, config.origin, config.ownerCookie);
    const owner = await evaluateOwner(`(${ownerFlow.toString()})(${JSON.stringify(config.repository)},${config.issueNumber})`);
    const evaluateOther = await page(chrome, config.origin, config.otherCookie);
    const other = await evaluateOther(`(${otherFlow.toString()})(${JSON.stringify(owner.itemId)})`);
    const { itemId, ...checks } = owner;
    const report = JSON.stringify({ status: owner.hostileFixture ? 'passed_configured_browser_checks' : 'incomplete_hostile_fixture', fixtureDigest: createHash('sha256').update(`${config.repository}#${config.issueNumber}`).digest('hex'), checks: { ...checks, ...other }, limitations: ['No revoked-access transition or seven-day clock advance performed.', 'Recurring retention and private-source admission remain separate gates.'] });
    if (!owner.hostileFixture) process.exitCode = 1;
    return report;
  } finally { await chrome.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then(report => console.log(report)).catch(() => { console.error('BLOCKED: browser UAT failed or is not configured; no cookies or issue text exported.'); process.exitCode = 1; });
