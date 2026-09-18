import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const rootExpression = `document.querySelector('#insta-toolbox-userscript-root').shadowRoot`;
const panelExpression = `(${rootExpression}).querySelector('[data-role="inbox-cleanup"]')`;
const conversations = [
  { id: '101', title: 'Alex Example', username: 'alex.example' },
  { id: '202', title: 'Alex Example', username: null },
  { id: '303', title: 'Weekend makers and exceptionally long conversation names', username: null },
];

function fixturePrelude() {
  return `<script>
    history.replaceState({}, '', '/direct/inbox/');
    const inboxRows = ${JSON.stringify(conversations)};
    const surface = document.querySelector('main');
    surface.innerHTML = '<section aria-label="Thread list" style="height:310px;overflow:auto"><div role="button" tabindex="0"><h2>fixture.owner</h2></div><div role="tab" aria-selected="true">Primary</div></section>';
    const rail = document.createElement('nav');
    rail.innerHTML = '<a role="link" href="/">Home</a><a role="link" href="/reels/">Reels</a><a role="link" href="/direct/inbox/">Inbox</a><a role="link" href="/fixture.owner/"><img alt="fixture.owner&#39;s profile picture" width="24" height="24" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22/%3E"></a>';
    document.body.append(rail);
    globalThis.fixtureInboxVisits = [];
    globalThis.fixtureInboxReturns = 0;
    globalThis.fixtureInboxMessageActions = 0;
    globalThis.fixtureInboxActionTrace = [];
    globalThis.fixtureInboxMessages = Object.fromEntries(inboxRows.map(item => [item.id,
      [{ key: 'received-before', sent: false, removed: false },
       { key: 'sent', sent: true, removed: false },
       { key: 'received-after', sent: false, removed: false }]]));
    let chat = null;
    function nativeMessage(list, item, message) {
      const timestamp = document.createElement('div');
      timestamp.style.cssText = 'height:22px;font-size:12px'; timestamp.textContent = 'Fixture timestamp';
      const slot = document.createElement('div'), wrapper = document.createElement('div');
      const group = document.createElement('div'); group.setAttribute('role', 'group');
      const column = document.createElement('div'); column.style.cssText = 'display:flex;flex-direction:column;justify-content:flex-start';
      const lane = document.createElement('div');
      lane.style.cssText = 'display:flex;flex-direction:row;justify-content:' + (message.sent ? 'flex-end' : 'flex-start');
      const spacer = document.createElement('div'); spacer.setAttribute('aria-hidden', 'true');
      const payload = document.createElement('div');
      payload.style.cssText = 'display:flex;flex-direction:' + (message.sent ? 'row-reverse' : 'row') + ';justify-content:flex-start';
      const body = document.createElement('div'); body.setAttribute('dir', 'auto');
      body.style.cssText = 'padding:10px;min-height:24px;background:#ddd;color:#111';
      body.textContent = 'Synthetic ' + item.id + ' ' + message.key;
      const actions = document.createElement('div'); actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'Message actions');
      const more = document.createElement('div'); more.setAttribute('role', 'button'); more.tabIndex = 0;
      more.setAttribute('aria-label', 'See more options for message from ' + (message.sent ? 'fixture.owner' : 'fixture.peer'));
      more.textContent = 'More'; actions.append(more); payload.append(body, actions);
      lane.append(spacer, payload); column.append(lane); group.append(column); wrapper.append(group); slot.append(wrapper);
      list.append(timestamp, slot);
      more.addEventListener('click', () => {
        globalThis.fixtureInboxMessageActions += 1;
        globalThis.fixtureInboxActionTrace.push({ thread: item.id, message: message.key, action: 'menu' });
        if (!message.sent || message.removed) throw new Error('Unexpected native message target');
        const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
        menu.style.cssText = 'position:fixed;top:160px;left:24px;z-index:20;background:white;padding:16px';
        const choice = document.createElement('button'); choice.textContent = 'Unsend'; menu.append(choice); document.body.append(menu);
        choice.addEventListener('click', () => {
          globalThis.fixtureInboxMessageActions += 1;
          globalThis.fixtureInboxActionTrace.push({ thread: item.id, message: message.key, action: 'choose-unsend' });
          menu.remove();
          const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
          dialog.style.cssText = 'position:fixed;top:160px;left:24px;z-index:20;background:white;padding:16px';
          const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => dialog.remove());
          const confirm = document.createElement('button'); confirm.textContent = 'Unsend';
          confirm.addEventListener('click', () => {
            globalThis.fixtureInboxMessageActions += 1;
            globalThis.fixtureInboxActionTrace.push({ thread: item.id, message: message.key, action: 'confirm-unsend' });
            if (!message.sent || message.removed) throw new Error('Duplicate or received message removal');
            dialog.remove(); slot.remove(); timestamp.remove();
            message.removed = true; globalThis.fixtureUnsentCount += 1;
          });
          dialog.append(cancel, confirm); document.body.append(dialog);
        });
      });
    }
    rail.querySelector('a[href="/direct/inbox/"]').addEventListener('click', event => {
      event.preventDefault(); chat?.remove(); chat = null;
      globalThis.fixtureInboxReturns += 1;
      history.replaceState({}, '', '/direct/inbox/');
    });
    for (const item of inboxRows) {
      const row = document.createElement('div');
      row.setAttribute('role', 'button'); row.tabIndex = 0;
      row.style.cssText = 'display:flex;align-items:center;gap:12px;min-height:48px';
      const avatar = document.createElement('img');
      avatar.alt = 'Synthetic conversation ' + item.id;
      avatar.width = 24; avatar.height = 24;
      avatar.src = rail.querySelector('img').src;
      const preview = document.createElement('span'); preview.textContent = 'Inbox preview ' + item.id;
      row.append(avatar, preview);
      row.addEventListener('click', () => {
        chat?.remove(); chat = document.createElement('section');
        const header = document.createElement('div'); header.setAttribute('data-pagelet', 'IGDInboxHeaderOffMsys');
        const heading = document.createElement('h2'); heading.textContent = item.title;
        if (item.username) {
          const profile = document.createElement('a'); profile.setAttribute('role', 'link');
          profile.href = '/' + item.username + '/';
          profile.setAttribute('aria-label', 'Open the profile page of synthetic participant');
          profile.append(heading); header.append(profile);
        } else header.append(heading);
        const content = document.createElement('div');
        const pane = document.createElement('div'); pane.setAttribute('data-pagelet', 'IGDMessagesList');
        const scroller = document.createElement('div');
        scroller.style.cssText = 'height:360px;overflow-y:scroll;display:flex;flex-direction:column-reverse';
        const list = document.createElement('div'); list.style.flex = 'none';
        for (const message of globalThis.fixtureInboxMessages[item.id]) {
          if (!message.removed) nativeMessage(list, item, message);
        }
        scroller.append(list); pane.append(scroller);
        const composer = document.createElement('div'); composer.setAttribute('data-pagelet', 'IGDComposerForCannes');
        composer.textContent = 'Synthetic message composer';
        content.append(pane, composer); chat.append(header, content); surface.append(chat);
        globalThis.fixtureInboxVisits.push(item.id);
        history.replaceState({}, '', '/direct/t/' + item.id + '/');
      });
      surface.querySelector('[aria-label="Thread list"]').append(row);
    }
  </script>`;
}

export async function acceptUserscriptInboxReview({
  window, isolatedSession, fixtureAssets, resultsRoot, releaseVersion,
  withTimeout, waitForPageValue, resizeViewport,
}) {
  const webContents = window.webContents;
  const screenshotRoot = path.join(resultsRoot, 'userscript-inbox-review');
  const requests = [], checks = [], states = [];
  await mkdir(screenshotRoot, { recursive: true });
  await isolatedSession.protocol.handle('http', () => new Response('', { status: 403 }));
  await isolatedSession.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.origin !== 'https://www.instagram.com') return new Response('', { status: 403 });
    if (url.pathname.startsWith('/api/')) {
      requests.push(url.pathname);
      return new Response('No API requests belong to native inbox discovery', { status: 500 });
    }
    const file = fixtureAssets.get(url.pathname);
    if (!file) return new Response('', { status: 404 });
    let body = await readFile(file);
    if (url.pathname === '/userscript-fixture.html') {
      body = body.toString().replace('<script src="/userscripts/insta-toolbox.user.js">',
        `${fixturePrelude()}<script src="/userscripts/insta-toolbox.user.js">`);
    }
    return new Response(body, { headers: {
      'Content-Type': file.endsWith('.html') ? 'text/html' : 'text/javascript',
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    } });
  });
  const evaluate = expression => webContents.executeJavaScript(expression, true);
  const button = text => `Array.from((${panelExpression}).querySelectorAll('button')).find(node => node.textContent === ${JSON.stringify(text)})`;
  const filter = async value => evaluate(`(() => {
    const input = (${panelExpression}).querySelector('[aria-label="Filter conversations"]');
    input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  const state = () => evaluate(`(() => {
    const root = ${rootExpression}, panel = ${panelExpression};
    const labels = [...panel.querySelectorAll('.inbox-selection > label')];
    return { rows: labels.map(label => ({ title: label.querySelector('span > span').textContent,
      identity: label.querySelector('small').textContent, hidden: label.hidden,
      selected: label.querySelector('input').checked })), text: panel.textContent,
      review: [...panel.querySelectorAll('button')].find(node => /^Review /.test(node.textContent))?.textContent,
      visits: [...globalThis.fixtureInboxVisits], returns: globalThis.fixtureInboxReturns,
      messageActions: globalThis.fixtureInboxMessageActions, removals: globalThis.fixtureUnsentCount,
      confirmationOpen: root.querySelector('[data-role="action-confirmation"]').open };
  })()`);
  try {
    await withTimeout(webContents.loadURL('https://www.instagram.com/userscript-fixture.html'), 'Ghost review generated-userscript fixture');
    await waitForPageValue(webContents, `Boolean(document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot?.querySelector('[data-role="inbox-cleanup"]'))`, 'Ghost review panel mount');
    await waitForPageValue(webContents, `!${button('Find conversations')}.disabled`, 'Ghost saved state loaded');
    assert.equal(await evaluate(`globalThis.InstaToolboxInstagramViewer.inspect({document,location}).accountVerified`), true);
    await evaluate(`(() => {
      const root = ${rootExpression}, panel = ${panelExpression};
      if (root.querySelector('.panel').hidden) root.querySelector('.launcher').click();
      root.querySelector('[data-view="messages"]').click();
      panel.closest('details').open = true;
      panel.querySelector('.inbox-choice input').click();
      ${button('Find conversations')}.click();
    })()`);
    await waitForPageValue(webContents, `(() => {
      const panel = ${panelExpression};
      return panel.querySelectorAll('.inbox-selection > label').length === 3
        && !${button('Find conversations')}.disabled;
    })()`, 'native Ghost discovery completed', 20_000);
    const discovered = await state();
    assert.deepEqual(discovered.rows.map(row => row.title), conversations.map(row => row.title), 'render native headers, not inbox previews');
    assert.match(discovered.rows[0].identity, /@alex\.example/);
    assert.ok(discovered.rows.slice(1).every(row => !row.identity.includes('@')), 'chat names never become inferred usernames');
    assert.deepEqual(discovered.visits, ['101', '202', '303']); assert.equal(discovered.returns, 3);
    assert.ok(discovered.rows.every(row => !row.selected));
    assert.match(discovered.text, /This may not include your whole inbox/);
    checks.push('native discovery renders exact headers and verified profile links without claiming a complete inbox');

    await filter('aLeX');
    assert.deepEqual((await state()).rows.map(row => row.hidden), [false, false, true]);
    await filter('@ALEX');
    assert.deepEqual((await state()).rows.map(row => row.hidden), [false, true, true]);
    assert.equal((await state()).review, 'Review 0 conversations');
    await evaluate(`${button('Select visible matches')}.click()`);
    await filter('Weekend');
    assert.deepEqual((await state()).rows.map(row => row.hidden), [true, true, false]);
    assert.match((await state()).text, /1 selected outside this filter/);
    await evaluate(`${button('Select visible matches')}.click()`);
    await filter('@missing');
    assert.ok((await state()).rows.every(row => row.hidden));
    assert.equal(await evaluate(`${button('Select visible matches')}.disabled`), true);
    assert.match((await state()).text, /2 selected outside this filter/);
    await filter('');
    assert.deepEqual((await state()).rows.map(row => row.selected), [true, false, true]);
    checks.push('plain and @ filters retain hidden selections without selecting duplicate names');

    await evaluate(`${button('Review 2 conversations')}.click()`);
    await waitForPageValue(webContents, `(${rootExpression}).querySelector('[data-role="action-confirmation"]').open`, 'Ghost exact review confirmation');
    const confirmation = await evaluate(`(${rootExpression}).querySelector('[data-role="action-confirmation"]').textContent`);
    assert.match(confirmation, /101, 303/); assert.doesNotMatch(confirmation, /202/);
    await evaluate(`Array.from((${rootExpression}).querySelector('[data-role="action-confirmation"]').querySelectorAll('button')).find(node => node.textContent.trim() === 'Cancel').click()`);
    await waitForPageValue(webContents, `!(${rootExpression}).querySelector('[data-role="action-confirmation"]').open && !${button('Find conversations')}.disabled`, 'Ghost review cancelled');
    assert.deepEqual((await state()).rows.map(row => row.selected), [true, false, true]);
    checks.push('Cancel preserves exact selection with zero message actions or removals');

    for (const viewport of [
      { label: 'desktop-dark', width: 1200, height: 800, zoom: 1, theme: 'dark' },
      { label: 'desktop-light', width: 1200, height: 800, zoom: 1, theme: 'light' },
      { label: 'narrow', width: 320, height: 720, zoom: 1, theme: 'dark' },
      { label: 'short', width: 900, height: 500, zoom: 1, theme: 'dark' },
      { label: 'zoom-200', width: 1280, height: 900, zoom: 2, theme: 'dark' },
    ]) {
      webContents.setZoomFactor(1); await resizeViewport(webContents, viewport); webContents.setZoomFactor(viewport.zoom);
      await filter('');
      await evaluate(`(() => {
        const root = ${rootExpression}, theme = root.querySelector('[data-preference="theme"]');
        theme.value = ${JSON.stringify(viewport.theme)}; theme.dispatchEvent(new Event('change', {bubbles:true}));
        root.querySelector('[data-view="messages"]').click();
        (${panelExpression}).closest('details').open = true;
      })()`);
      await waitForPageValue(webContents, `getComputedStyle((${rootExpression}).querySelector('.panel')).color === ${JSON.stringify(viewport.theme === 'dark' ? 'rgb(243, 243, 243)' : 'rgb(23, 23, 23)')}`, 'Ghost rendered theme');
      const metrics = await evaluate(`(async () => {
        const root = ${rootExpression}, inbox = ${panelExpression};
        const panel = root.querySelector('.panel'), scroll = root.querySelector('.scroll');
        const visible = node => node.getClientRects().length && !node.closest('[hidden]');
        const nodes = [...inbox.querySelectorAll('button,input,select,a')].filter(visible)
          .map(node => node.matches('input[type="checkbox"]') ? node.closest('label') : node);
        const controls = [];
        const settleScroll = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const measureControl = node => {
          const rect = node.getBoundingClientRect(), clip = scroll.getBoundingClientRect();
          const hit = root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {name:node.getAttribute('aria-label') || node.textContent.trim(), width:rect.width,height:rect.height,
            left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,clipTop:clip.top,clipBottom:clip.bottom,
            reachable:rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1,
            receivesPointer:hit === node || node.contains(hit),
            hit:hit?.getAttribute?.('aria-label') || hit?.textContent?.trim?.() || hit?.tagName || null};
        };
        for (const node of nodes) {
          let control = null;
          for (const block of ['center', 'start', 'end']) {
            node.scrollIntoView({block,inline:'nearest'});
            await settleScroll();
            control = measureControl(node);
            if (control.reachable && control.receivesPointer) break;
          }
          if (!control.reachable || !control.receivesPointer) {
            (node.matches('label') ? node.querySelector('input') : node)?.focus?.({preventScroll:false});
            await settleScroll();
            control = measureControl(node);
          }
          controls.push(control);
        }
        const bounds = panel.getBoundingClientRect();
        const labels = [...inbox.querySelectorAll('.inbox-selection > label')];
        const overlap = labels.slice(1).some((label,index) => label.getBoundingClientRect().top < labels[index].getBoundingClientRect().bottom - 1);
        return {controls,overlap,width:innerWidth,height:innerHeight,
          panel:{left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom},
          overflow:inbox.scrollWidth-inbox.clientWidth,scrollOverflow:scroll.scrollWidth-scroll.clientWidth,
          liveRegions:root.querySelectorAll('[aria-live]').length};
      })()`);
      assert.equal(metrics.controls.length, 12, `${viewport.label}: populated review controls`);
      assert.ok(metrics.controls.some(control => control.name === 'Managed worker tabs'),
        `${viewport.label}: managed worker count control`);
      assert.ok(metrics.controls.some(control => control.name === 'Worker tab opening'),
        `${viewport.label}: worker opening control`);
      assert.ok(metrics.controls.every(control => control.height >= 44 && control.width >= 44), `${viewport.label}: undersized controls ${JSON.stringify(metrics)}`);
      assert.ok(metrics.controls.every(control => control.reachable && control.receivesPointer), `${viewport.label}: inaccessible controls ${JSON.stringify(metrics)}`);
      assert.ok(metrics.controls.every(control => control.left >= metrics.panel.left - 1 && control.right <= metrics.panel.right + 1));
      assert.ok(metrics.panel.left >= -1 && metrics.panel.top >= -1 && metrics.panel.right <= metrics.width + 1 && metrics.panel.bottom <= metrics.height + 1);
      assert.ok(metrics.overflow <= 1 && metrics.scrollOverflow <= 1, `${viewport.label}: horizontal overflow`);
      assert.equal(metrics.overlap, false); assert.equal(metrics.liveRegions, 1);
      assert.equal(webContents.getZoomFactor(), viewport.zoom);
      if (viewport.zoom === 2) assert.ok(metrics.width <= 650, '200% uses the Chromium layout viewport');
      const screenshots = [];
      for (const position of ['list', 'filtered']) {
        await filter(position === 'filtered' ? '@alex' : '');
        await evaluate(`(() => {
          (${panelExpression}).querySelector('[aria-label="Filter conversations"]').closest('label').scrollIntoView({block:'start',inline:'nearest'});
          return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`);
        await withTimeout(new Promise(resolve => { webContents.once('paint', resolve); webContents.invalidate(); }), 'Ghost review screenshot');
        const filename = `${viewport.label}-${position}.png`;
        await writeFile(path.join(screenshotRoot, filename), (await webContents.capturePage()).toPNG()); screenshots.push(filename);
      }
      states.push({ viewport, metrics, screenshots });
    }
    const final = await state();
    assert.deepEqual(final.visits, discovered.visits); assert.equal(final.returns, discovered.returns);
    assert.equal(final.messageActions, 0); assert.equal(final.removals, 0); assert.equal(final.confirmationOpen, false);
    assert.deepEqual(requests, []);

    webContents.setZoomFactor(1);
    await resizeViewport(webContents, { label: 'Ghost execution', width: 1200, height: 800 });
    await filter('');
    assert.deepEqual((await state()).rows.map(row => row.selected), [true, false, true]);
    await evaluate(`(() => {
      globalThis.fixtureInboxRunnerOutcomes = [];
      globalThis.InstaToolboxDmThreadUnsender.subscribe(value => {
        if (value.status === 'completed') globalThis.fixtureInboxRunnerOutcomes.push({
          path: location.pathname, processed: value.processed, failed: value.failed, uncertain: value.uncertain });
      });
      ${button('Review 2 conversations')}.click();
    })()`);
    await waitForPageValue(webContents, `(${rootExpression}).querySelector('[data-role="action-confirmation"]').open`, 'Ghost execution confirmation');
    assert.match(await evaluate(`(${rootExpression}).querySelector('[data-role="action-confirmation"]').textContent`), /101, 303/);
    const point = await evaluate(`(() => {
      const button = (${rootExpression}).querySelector('[data-action="confirm-accept"]');
      button.scrollIntoView({block:'center',inline:'center'});
      const bounds = button.getBoundingClientRect();
      return {x:Math.round(bounds.left+bounds.width/2),y:Math.round(bounds.top+bounds.height/2),
        ready:!button.disabled && bounds.width > 0 && bounds.height > 0};
    })()`);
    assert.equal(point.ready, true, 'reviewed two-conversation action is enabled');
    webContents.focus();
    webContents.sendInputEvent({type:'mouseMove',x:point.x,y:point.y});
    webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button:'left',clickCount:1});
    webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y,button:'left',clickCount:1});
    await waitForPageValue(webContents, `(() => {
      const histories = Object.entries(globalThis.fixtureGmStore).filter(([key]) => key.startsWith('instaToolboxInboxHistoryV1:'));
      const job = histories[0]?.[1]?.jobs?.[0];
      return job?.status === 'completed' && !${button('Find conversations')}.disabled;
    })()`, 'two native conversations completed through the shared runner', 45_000);
    const execution = await evaluate(`(() => {
      const history = Object.entries(globalThis.fixtureGmStore).filter(([key]) => key.startsWith('instaToolboxInboxHistoryV1:'));
      const forbidden = new Set(['authority','capability','token','approval','approved','lease','leaseToken','nonce','documentId','canStart','lockHeld']);
      const leakedFields = [];
      const inspect = (value, path = '') => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
          if (forbidden.has(key)) leakedFields.push(path + '.' + key);
          inspect(child, path + '.' + key);
        }
      };
      for (const [, value] of history) inspect(value);
      return { trace: globalThis.fixtureInboxActionTrace, messages: globalThis.fixtureInboxMessages,
        outcomes: globalThis.fixtureInboxRunnerOutcomes, visits: globalThis.fixtureInboxVisits,
        returns: globalThis.fixtureInboxReturns, removals: globalThis.fixtureUnsentCount,
        nativeClicks: globalThis.fixtureInboxMessageActions, histories: history.map(([,value]) => value), leakedFields,
        receivedMounted: [...document.querySelectorAll('[data-pagelet="IGDMessagesList"] [dir="auto"]')]
          .map(node => node.textContent), confirmationOpen: (${rootExpression}).querySelector('[data-role="action-confirmation"]').open };
    })()`);
    assert.deepEqual(execution.trace, ['101', '303'].flatMap(thread =>
      ['menu', 'choose-unsend', 'confirm-unsend'].map(action => ({thread,message:'sent',action}))));
    assert.equal(execution.nativeClicks, 6); assert.equal(execution.removals, 2);
    assert.deepEqual(execution.visits, ['101', '202', '303', '101', '303']); assert.equal(execution.returns, 4);
    for (const thread of ['101', '303']) {
      assert.deepEqual(execution.messages[thread].map(message => message.removed), [false, true, false]);
    }
    assert.ok(execution.messages['202'].every(message => !message.removed), 'unselected conversation is untouched');
    assert.deepEqual(execution.receivedMounted, ['Synthetic 303 received-before', 'Synthetic 303 received-after']);
    assert.deepEqual(execution.outcomes, ['101', '303'].map(thread => ({path:`/direct/t/${thread}/`,processed:1,failed:0,uncertain:0})));
    assert.equal(execution.histories.length, 1); assert.equal(execution.histories[0].jobs.length, 1);
    const saved = execution.histories[0].jobs[0];
    assert.equal(saved.status, 'completed'); assert.equal(saved.pendingMutation, null);
    assert.deepEqual(saved.review.threadIds, ['101', '303']);
    assert.deepEqual(saved.tasks.map(task => ({threadId:task.threadId,status:task.status,removed:task.messageRemovals})),
      ['101', '303'].map(threadId => ({threadId,status:'completed',removed:1})));
    assert.deepEqual(execution.leakedFields, []); assert.equal(execution.confirmationOpen, false);
    assert.ok(conversations.every(item => !JSON.stringify(execution.histories).includes(item.title)), 'private checkpoints omit display names');
    assert.ok(!JSON.stringify(execution.histories).includes('Synthetic '), 'private checkpoints omit message bodies');
    assert.deepEqual(requests, []);
    checks.push('trusted approval runs two exact native conversations serially through the real controller and shared runner');
    checks.push('two verified removals retain received messages and the unselected chat without saving runtime authority');
    await writeFile(path.join(screenshotRoot, 'metrics.json'), `${JSON.stringify({fixtureOnly:true,version:releaseVersion,checks,states,execution},null,2)}\n`);
    console.log(`Accepted generated userscript Ghost cleanup: ${checks.length} behavioral gates, ${states.length} rendered states, two verified synthetic removals through the shared runner.`);
  } finally {
    webContents.setZoomFactor(1);
    isolatedSession.protocol.unhandle('https'); isolatedSession.protocol.unhandle('http');
  }
}
