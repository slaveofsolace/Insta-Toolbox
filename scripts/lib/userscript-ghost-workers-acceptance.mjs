import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BrowserWindow, ipcMain, session } from 'electron';
import { inboxFixturePrelude } from './userscript-inbox-review-acceptance.mjs';

const ROOT = `document.querySelector('#insta-toolbox-userscript-root').shadowRoot`;
const PANEL = `(${ROOT}).querySelector('[data-role="inbox-cleanup"]')`;
const button = label => `[...(${PANEL}).querySelectorAll('button')].find(node=>node.textContent===${JSON.stringify(label)})`;

// Real renderer windows and Web Locks; only the userscript-manager transport
// and Instagram page are fixtures. No live network or account is used.
export async function acceptUserscriptGhostWorkers({ fixtureAssets, resultsRoot, releaseVersion, withTimeout, waitForPageValue }) {
  const isolated = session.fromPartition(`insta-toolbox-ghost-windows-${process.pid}`);
  const windows = new Map(), store = new Map(), outcomes = [], opened = [], tabEvents = [];
  const tabStorage = new Map();
  const conversations = Array.from({ length: 12 }, (_, index) => ({
    id: String(101 + index), title: `Synthetic conversation ${index + 1}`, username: null,
  }));
  const problems = [];
  let coordinator, peakWorkers = 0;
  const assertSender = event => assert.ok(windows.has(event.sender.id), 'unowned fixture IPC sender');
  const createWindow = () => {
    const window = new BrowserWindow({ show: false, width: 1200, height: 900,
      webPreferences: { session: isolated, contextIsolation: true, nodeIntegration: false,
        preload: fileURLToPath(new URL('./ghost-fixture-preload.cjs', import.meta.url)),
        backgroundThrottling: false, offscreen: true } });
    windows.set(window.webContents.id, window);
    window.webContents.on('render-process-gone', (_event, details) => problems.push(details.reason));
    return window;
  };
  const get = (event, key, fallback) => { assertSender(event); event.returnValue = store.has(key) ? store.get(key) : fallback; };
  const set = (event, key, value) => {
    assertSender(event);
    const previous = store.get(key); store.set(key, structuredClone(value));
    for (const window of windows.values()) if (!window.isDestroyed()) {
      window.webContents.send('fixture-ghost:changed', key, previous, value);
    }
    event.returnValue = null;
  };
  ipcMain.on('fixture-ghost:get', get); ipcMain.on('fixture-ghost:set', set);
  const getTab = event => { assertSender(event); event.returnValue = tabStorage.get(event.sender.id) || {}; };
  const saveTab = (event, value) => { assertSender(event); tabStorage.set(event.sender.id, structuredClone(value)); event.returnValue = null; };
  ipcMain.on('fixture-ghost:get-tab', getTab); ipcMain.on('fixture-ghost:save-tab', saveTab);
  ipcMain.handle('fixture-ghost:open', async (event, url, options) => {
    assertSender(event); assert.equal(event.sender, coordinator.webContents);
    const target = new URL(url);
    assert.equal(target.origin, 'https://www.instagram.com');
    assert.ok(conversations.some(item => target.pathname === `/direct/t/${item.id}/`));
    assert.match(target.hash, /^#insta-toolbox-worker=/);
    assert.equal(options.active, false);
    const worker = createWindow(); opened.push(target.pathname); tabEvents.push({ action: 'open', path: target.pathname });
    peakWorkers = Math.max(peakWorkers, windows.size - 1);
    await worker.loadURL(url);
    return worker.webContents.id;
  });
  ipcMain.handle('fixture-ghost:close', async (event, id) => {
    assertSender(event); assert.equal(event.sender, coordinator.webContents);
    const worker = windows.get(id);
    assert.ok(worker && worker !== coordinator, 'only a managed worker may close');
    const outcome = await worker.webContents.executeJavaScript(`({
      path:location.pathname, removals:fixtureUnsentCount,
      visits:globalThis.fixtureInboxVisits,
      receivedIntact:Object.values(fixtureInboxMessages).flat().filter(item=>!item.sent).every(item=>!item.removed)
    })`, true);
    outcomes.push(outcome); tabEvents.push({ action: 'close', path: outcome.path });
    windows.delete(id); worker.destroy();
  });
  await isolated.protocol.handle('http', () => new Response('', { status: 403 }));
  await isolated.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.origin !== 'https://www.instagram.com') return new Response('', { status: 403 });
    const page = url.pathname === '/userscript-fixture.html' || url.pathname === '/direct/inbox/'
      || /^\/direct\/t\/\d+\/$/.test(url.pathname);
    const file = fixtureAssets.get(page ? '/userscript-fixture.html' : url.pathname);
    if (!file) return new Response('', { status: 404 });
    let body = await readFile(file);
    if (page) {
      const setup = `${inboxFixturePrelude({ rows: conversations })}<script>
        const inboxLink=document.querySelector('nav a[href="/direct/inbox/"]');
        const messagesLink=document.createElement('a');messagesLink.href='/direct/t/101/';messagesLink.setAttribute('aria-label','Messages');messagesLink.textContent='Messages';
        inboxLink.replaceWith(messagesLink);
        messagesLink.addEventListener('click',event=>{event.preventDefault();document.querySelector('[data-fixture-thread="101"]').click();});
        let listenerId=0; const listeners=new Map();
        GM_getValue=(key,fallback)=>fixtureGhostTransport.get(key,Object.hasOwn(fixtureGmStore,key)?fixtureGmStore[key]:fallback);
        GM_setValue=(key,value)=>fixtureGhostTransport.set(key,value);
        const fixtureThread=new URL(fixtureLaunchHref).pathname.match(/^\\/direct\\/t\\/(\\d+)\\/$/)?.[1];
        let fixtureRedirected=false;
        GM_getTab=callback=>callback(fixtureGhostTransport.getTab());
        GM_saveTab=value=>{
          fixtureGhostTransport.saveTab(value);
          // A document-start userscript runs before Instagram startup. Trigger
          // that startup only after its early tab correlation is captured,
          // not on a timer racing the fixture's external script download.
          if(fixtureThread && !fixtureRedirected && value.instaToolboxGhostLaunchV1){
            fixtureRedirected=true;
            if(Number(fixtureThread)%2) location.replace('/direct/inbox/');
            else history.replaceState({},'','/direct/inbox/');
          }
        };
        globalThis.GM_addValueChangeListener=(key,callback)=>{const id=++listenerId;listeners.set(id,{key,callback});return id;};
        globalThis.GM_removeValueChangeListener=id=>listeners.delete(id);
        fixtureGhostTransport.listen((key,previous,next)=>{for(const item of listeners.values())if(item.key===key)item.callback(key,previous,next,true);});
        globalThis.GM_openInTab=async(url,options)=>{const id=await fixtureGhostTransport.open(url,options);return {close:()=>fixtureGhostTransport.close(id)};};
        if(fixtureThread){
          history.replaceState({},'',fixtureLaunchHref);
          // Instagram may restore the inbox instead of honoring a new-tab
          // deep link. Only production navigation may open the assigned row.
        }else history.replaceState({},'',new URL(fixtureLaunchHref).pathname==='/direct/inbox/' ? '/direct/inbox/' : '/');
      </script>`;
      body = body.toString().replace('<head>', '<head><script>const fixtureLaunchHref=location.href;</script>')
        .replace('<script src="/userscripts/insta-toolbox.user.js">', `${setup}<script src="/userscripts/insta-toolbox.user.js">`);
    }
    return new Response(body, { headers: { 'Content-Type': page ? 'text/html' : 'text/javascript',
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" } });
  });
  try {
    coordinator = createWindow();
    const web = coordinator.webContents, evaluate = expression => web.executeJavaScript(expression, true);
    await withTimeout(web.loadURL('https://www.instagram.com/userscript-fixture.html'), 'Ghost multi-window fixture');
    await waitForPageValue(web, `Boolean(${PANEL}) && !${button('Find conversations')}.disabled`, 'Ghost coordinator ready');
    await evaluate(`(() => {
      const root=${ROOT}, panel=${PANEL};
      if(root.querySelector('.panel').hidden)root.querySelector('.launcher').click();
      root.querySelector('[data-view="messages"]').click();
      const workers=panel.querySelector('[aria-label="Managed worker tabs"]');workers.value='2';workers.dispatchEvent(new Event('change',{bubbles:true}));
      const mode=panel.querySelector('[aria-label="Worker tab opening"]');mode.value='background';mode.dispatchEvent(new Event('change',{bubbles:true}));
      ${button('Start Ghost Mode')}.click();
    })()`);
    try {
      // Twelve rows traverse several inbox windows using production readiness waits.
      await waitForPageValue(web, `${ROOT}.querySelector('[data-role="action-confirmation"]').open`, 'Ghost discovery and review dialog', 60_000);
    } catch (error) {
      const state = await evaluate(`({path:location.pathname,visits:fixtureInboxVisits,panel:${PANEL}.textContent})`);
      throw new Error(`${error.message} ${JSON.stringify(state)}`);
    }
    assert.equal(opened.length, 0, 'review must not open execution tabs');
    const point = await evaluate(`(() => {const node=${ROOT}.querySelector('[data-action="confirm-accept"]');node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
    web.focus();
    for (const type of ['mouseDown', 'mouseUp']) web.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    const deadline = Date.now() + 90_000;
    while ((!store.get('instaToolboxGhostJobV1') || store.get('instaToolboxGhostJobV1').status === 'running'
      || windows.size !== 1) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const job = store.get('instaToolboxGhostJobV1');
    if(job?.status !== 'completed' || windows.size !== 1){
      const diagnostics=[];
      for(const worker of windows.values()) if(worker !== coordinator && !worker.isDestroyed()){
        diagnostics.push(await worker.webContents.executeJavaScript(`({path:location.pathname,
          visits:globalThis.fixtureInboxVisits,tab:fixtureGhostTransport.getTab(),
          panel:document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot?.querySelector('[data-role="inbox-cleanup"]')?.textContent})`,true));
      }
      console.error('Synthetic Ghost worker diagnostics:',JSON.stringify(diagnostics));
      console.error('Closed synthetic Ghost workers:',JSON.stringify(outcomes));
    }
    assert.equal(job?.status, 'completed', JSON.stringify(job));
    assert.equal(windows.size, 1); assert.equal(peakWorkers, 10);
    assert.equal(job.scheduling, 'batches'); assert.equal(job.workerCount, 10);
    const approvedPaths = job.tasks.map(item => `/direct/t/${item.threadId}/`);
    assert.deepEqual(opened, approvedPaths);
    assert.deepEqual([...opened].sort(), conversations.map(item => `/direct/t/${item.id}/`).sort());
    assert.deepEqual(tabEvents.slice(0, 10), approvedPaths.slice(0, 10).map(path => ({ action: 'open', path })));
    assert.ok(tabEvents.slice(10, 20).every(item => item.action === 'close'), 'all first-batch windows close before the next batch opens');
    assert.deepEqual(new Set(tabEvents.slice(10, 20).map(item => item.path)), new Set(opened.slice(0, 10)));
    assert.deepEqual(tabEvents.slice(20, 22), approvedPaths.slice(10).map(path => ({ action: 'open', path })));
    assert.ok(tabEvents.slice(22).every(item => item.action === 'close'));
    assert.ok(job.tasks.every(task => task.status === 'completed' && task.messageRemovals === 1));
    assert.equal(job.pendingMutation, null);
    assert.equal(outcomes.length, 12); assert.ok(outcomes.every(item => item.removals === 1 && item.receivedIntact));
    assert.deepEqual(problems, []);
    const directory = path.join(resultsRoot, 'userscript-ghost-workers'); await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ version: releaseVersion, fixtureOnly: true,
      transport: 'fixture GM API shim; real renderer windows and Web Locks', peakWorkers, opened, tabEvents, outcomes,
      tasks: job.tasks.map(({ threadId, status, messageRemovals }) => ({ threadId, status, messageRemovals })) }, null, 2));
    console.log('Accepted generated userscript Ghost: redirected inbox workers recover exact threads through native rows, 12 conversations in ten-then-two batches, verified removals and received messages preserved.');
  } finally {
    for (const window of windows.values()) if (!window.isDestroyed()) window.destroy();
    ipcMain.removeListener('fixture-ghost:get', get); ipcMain.removeListener('fixture-ghost:set', set);
    ipcMain.removeListener('fixture-ghost:get-tab', getTab); ipcMain.removeListener('fixture-ghost:save-tab', saveTab);
    ipcMain.removeHandler('fixture-ghost:open'); ipcMain.removeHandler('fixture-ghost:close');
    isolated.protocol.unhandle('http'); isolated.protocol.unhandle('https');
  }
}
