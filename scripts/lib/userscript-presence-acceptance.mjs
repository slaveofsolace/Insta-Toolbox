import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OWNER = 'fixture.owner';
const rows = [
  { pk: '201', username: 'mutual_friend' },
  { pk: '202', username: 'followback_friend' },
  { pk: '203', username: 'protected_friend' },
];
const rootExpression = `document.querySelector('#insta-toolbox-userscript-root').shadowRoot`;

function fixturePrelude(imported, preferences) {
  return `<script>
    history.replaceState({}, '', '/direct/inbox/');
    document.querySelector('main').innerHTML = '<section aria-label="Thread list"><div role="button" tabindex="0"><h2>${OWNER}</h2></div></section>';
    const rail = document.createElement('nav');
    rail.innerHTML = '<a role="link" href="/">Home</a><a role="link" href="/reels/">Reels</a><a role="link" href="/direct/inbox/">Inbox</a><a role="link" href="/${OWNER}/"><img alt="${OWNER}&#39;s profile picture" width="24" height="24" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22/%3E"></a>';
    document.body.append(rail);
    globalThis.fixturePresenceNativeClicks = 0;
    document.addEventListener('click', event => {
      if (event.target.closest('a,button,[role="button"]')) globalThis.fixturePresenceNativeClicks += 1;
    });
    if (${Boolean(preferences)}) globalThis.fixtureGmStore.instaToolboxPresencePreferencesV1 = ${JSON.stringify(preferences)};
    if (${imported}) {
      const capture = { subjectUsername: '${OWNER}', subjectInstagramId: '77',
        followers: ${JSON.stringify(rows.map(row => ({ username: row.username, instagramId: row.pk, source: 'authenticated-instagram-web' })))},
        following: [{ username: 'mutual_friend', instagramId: '201', source: 'authenticated-instagram-web' }],
        capturedAt: { followers: new Date().toISOString(), following: new Date().toISOString() },
        complete: { followers: true, following: true }, verified: { followers: true, following: true },
        source: { followers: 'authenticated-web', following: 'authenticated-web' } };
      Object.assign(globalThis.fixtureGmStore.instaToolboxUserscriptStateV2, { schemaVersion: 6, capture });
      globalThis.fixtureManagerTab.instaToolboxCheckerDraftV1 = { schemaVersion: 6, capture };
    }
  </script>`;
}

export async function acceptUserscriptPresence({
  window, isolatedSession, fixtureAssets, resultsRoot, releaseVersion,
  withTimeout, waitForPageValue, resizeViewport,
}) {
  const webContents = window.webContents;
  const requests = [], checks = [];
  let savedPreferences = null;
  const screenshotRoot = path.join(resultsRoot, 'userscript-presence');
  await mkdir(screenshotRoot, { recursive: true });
  await isolatedSession.protocol.handle('http', () => new Response('', { status: 403 }));
  await isolatedSession.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.origin !== 'https://www.instagram.com') return new Response('', { status: 403 });
    if (url.pathname.startsWith('/api/')) {
      requests.push(url.pathname);
      if (url.pathname === '/api/v1/web/search/topsearch/') {
        const username = url.searchParams.get('query');
        return Response.json({ users: [{ user: { pk: username === OWNER ? '77' : '88', username } }] });
      }
      if (url.pathname === '/api/v1/users/web_profile_info/') {
        const username = url.searchParams.get('username');
        return Response.json({ data: { user: { username, id: username === OWNER ? '77' : '88',
          edge_followed_by: { count: 3 }, edge_follow: { count: 1 } } } });
      }
      if (/^\/api\/v1\/friendships\/(77|88)\/followers\/$/.test(url.pathname)) return Response.json({ users: rows });
      if (/^\/api\/v1\/friendships\/(77|88)\/following\/$/.test(url.pathname)) return Response.json({ users: [rows[0]] });
      return new Response('Unexpected fixture endpoint', { status: 500 });
    }
    const file = fixtureAssets.get(url.pathname);
    if (!file) return new Response('', { status: 404 });
    let body = await readFile(file);
    if (url.pathname === '/userscript-fixture.html') {
      body = body.toString().replace('<script src="/userscripts/insta-toolbox.user.js">',
        `${fixturePrelude(url.searchParams.has('presence-imported'), savedPreferences)}<script src="/userscripts/insta-toolbox.user.js">`);
    }
    return new Response(body, { headers: {
      'Content-Type': file.endsWith('.html') ? 'text/html' : 'text/javascript',
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    } });
  });
  const evaluate = expression => webContents.executeJavaScript(expression, true);
  const button = text => `Array.from((${rootExpression}).querySelectorAll('.presence-routine button')).find(node => node.textContent === ${JSON.stringify(text)})`;
  const openPresence = async () => {
    await evaluate(`(() => {
      const root = ${rootExpression};
      if (root.querySelector('.panel').hidden) root.querySelector('.launcher').click();
      root.querySelector('[data-view="account"]').click();
      root.querySelector('[data-role="presence-disclosure"]').open = true;
    })()`);
  };
  const openChoices = () => evaluate(`(() => {
    const panel = (${rootExpression}).querySelector('.presence-routine');
    panel.querySelector('[data-presence="choices"]').open = true;
    panel.querySelector('[data-presence="start"]').closest('details').open = true;
  })()`);
  const readState = () => evaluate(`(() => {
    const root = ${rootExpression}, panel = root.querySelector('.presence-routine');
    return { feedback: panel.querySelector('.presence-results').previousElementSibling.textContent,
      resultsHidden: panel.querySelector('.presence-results').hidden,
      targets: [...panel.querySelectorAll('[aria-label="Suggested accounts"] strong')].map(node => node.textContent),
      held: panel.querySelector('.presence-results').textContent,
      visibleButtons: [...panel.querySelectorAll('button')].filter(node => node.getClientRects().length).map(node => node.textContent),
      choicesOpen: panel.querySelector('[data-presence="choices"]').open,
      planningNote: [...panel.querySelectorAll('.presence-note')].filter(node => node.textContent === 'Planning only. No actions run here.').length,
      nativeClicks: globalThis.fixturePresenceNativeClicks,
      removals: globalThis.fixtureUnsentCount,
      confirmationOpen: root.querySelector('[data-role="action-confirmation"]').open };
  })()`);
  const load = async imported => {
    await withTimeout(webContents.loadURL(`https://www.instagram.com/userscript-fixture.html${imported ? '?presence-imported=1' : ''}`), 'Presence generated-userscript fixture');
    await waitForPageValue(webContents, `Boolean(document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot?.querySelector('.presence-routine'))`, 'Presence panel mount');
    await waitForPageValue(webContents, `!${button('Build my plan')}.disabled`, 'Presence preferences loaded');
    assert.equal(await evaluate(`globalThis.InstaToolboxInstagramViewer.inspect({document,location}).accountVerified`), true,
      'synthetic native account-picker and navigation establish the viewer');
    await openPresence();
  };
  const capture = async username => {
    const before = requests.length;
    await evaluate(`(() => {
      const root = ${rootExpression}; root.querySelector('[data-view="checker"]').click();
      root.querySelector('[data-role="checker-username"]').value = ${JSON.stringify(username)};
      root.querySelector('[data-action="check-account-relationships"]').click();
    })()`);
    await waitForPageValue(webContents, `(() => {
      const root = ${rootExpression};
      const capture = globalThis.fixtureManagerTab.instaToolboxCheckerDraftV1?.capture;
      return capture?.subjectUsername === ${JSON.stringify(username)} && capture.complete?.followers
        && capture.complete?.following && !root.querySelector('[data-action="check-account-relationships"]').textContent.includes('Stop');
    })()`, 'Presence original checker receipt').catch(async error => {
      const diagnostic = await evaluate(`({
        capture:globalThis.fixtureManagerTab.instaToolboxCheckerDraftV1?.capture,
        status:(${rootExpression}).querySelector('[aria-live]')?.textContent,
        progress:(${rootExpression}).querySelector('[data-role="scan-detail"]')?.textContent,
        button:(${rootExpression}).querySelector('[data-action="check-account-relationships"]')?.textContent
      })`);
      throw new Error(`${error.message} ${JSON.stringify({requests:requests.slice(before),diagnostic})}`);
    });
    const id = username === OWNER ? '77' : '88';
    assert.deepEqual(requests.slice(before), ['/api/v1/web/search/topsearch/', '/api/v1/users/web_profile_info/',
      `/api/v1/friendships/${id}/followers/`, `/api/v1/friendships/${id}/following/`, '/api/v1/users/web_profile_info/']);
    await openPresence();
  };
  const build = async () => {
    const before = requests.length;
    await evaluate(`${button('Build my plan')}.click()`);
    const state = await readState();
    assert.equal(requests.length, before, 'planning issues no additional request');
    assert.equal(state.nativeClicks, 0); assert.equal(state.removals, 0); assert.equal(state.confirmationOpen, false);
    assert.ok(state.visibleButtons.every(name => !/^(Start|Review )/.test(name)), 'no execution/review affordance without native integration');
    return state;
  };
  try {
    await load(true);
    const imported = await build();
    assert.equal(imported.resultsHidden, true);
    assert.match(imported.feedback, /Run Mutual Checker for your account from the inbox/);
    assert.equal(requests.length, 0, 'persisted imported lists cannot manufacture a runtime receipt');
    checks.push('imported-only lists unavailable');

    await load(false);
    await capture('fixture.other');
    const other = await build();
    assert.equal(other.resultsHidden, true); assert.match(other.feedback, /Run Mutual Checker for your account from the inbox/);
    checks.push('other-account capture unavailable');

    await capture(OWNER);
    await openChoices();
    await evaluate(`(() => {
      const panel = (${rootExpression}).querySelector('.presence-routine');
      const minute = new Date().getHours() * 60 + new Date().getMinutes();
      for (const [key, value] of [['start', minute], ['end', (minute + 60) % 1440]]) {
        const node = panel.querySelector('[data-presence="' + key + '"]');
        node.value = String(Math.floor(value / 60)).padStart(2,'0') + ':' + String(value % 60).padStart(2,'0');
        node.dispatchEvent(new Event('input', {bubbles:true}));
      }
    })()`);
    const privacyHeld = await build();
    assert.equal(privacyHeld.resultsHidden, false); assert.deepEqual(privacyHeld.targets, []);
    assert.match(privacyHeld.held, /Private or unknown account visibility/);
    assert.equal(privacyHeld.choicesOpen, false); assert.equal(privacyHeld.planningNote, 1);
    await openChoices();
    await evaluate(`(() => {
      const panel = (${rootExpression}).querySelector('.presence-routine');
      for (const [key, value] of [['allowance','2'],['protected','@protected_friend']]) {
        const node = panel.querySelector('[data-presence="' + key + '"]'); node.value = value;
        node.dispatchEvent(new Event('input', {bubbles:true}));
      }
      const privacy = panel.querySelector('[data-presence="private"]'); privacy.checked = true;
      privacy.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    const planned = await build();
    assert.deepEqual(planned.targets, ['@followback_friend']);
    assert.match(planned.held, /1 suggested/);
    assert.equal(planned.choicesOpen, false);
    assert.equal(planned.visibleButtons.includes('Build my plan'), false, 'a valid plan has no duplicate Build action');
    checks.push('own-account original capture, options, unknown privacy and protected account respected');

    await openChoices();
    await evaluate(`(() => {
      const panel = (${rootExpression}).querySelector('.presence-routine');
      for (const key of ['allowance','protected','start','end']) {
        panel.querySelector('[data-presence="' + key + '"]').dispatchEvent(new Event('change', {bubbles:true}));
      }
    })()`);
    await waitForPageValue(webContents, `(() => {
      const saved = globalThis.fixtureGmStore.instaToolboxPresencePreferencesV1;
      const panel = (${rootExpression}).querySelector('.presence-routine');
      const minute = key => { const [h,m] = panel.querySelector('[data-presence="' + key + '"]').value.split(':').map(Number); return h * 60 + m; };
      return saved?.followLimit === 2 && saved.protectedHandles?.[0] === 'protected_friend'
        && saved.skipPrivate === false && saved.window?.start === minute('start') && saved.window?.end === minute('end');
    })()`, 'Presence private preferences saved').catch(async error => {
      const detail = await evaluate(`({saved:globalThis.fixtureGmStore.instaToolboxPresencePreferencesV1,
        note:(${rootExpression}).querySelector('[data-presence="storage"]').textContent})`);
      throw new Error(`${error.message} ${JSON.stringify(detail)}`);
    });
    savedPreferences = await evaluate('structuredClone(globalThis.fixtureGmStore.instaToolboxPresencePreferencesV1)');
    assert.deepEqual(Object.keys(savedPreferences).sort(), ['followLimit','protectedHandles','schemaVersion','skipPrivate','window']);
    await load(false);
    assert.deepEqual(await evaluate(`(() => {
      const panel = (${rootExpression}).querySelector('.presence-routine');
      return { count:panel.querySelector('[data-presence="allowance"]').value,
        protected:panel.querySelector('[data-presence="protected"]').value,
        private:panel.querySelector('[data-presence="private"]').checked };
    })()`), {count:'2',protected:'@protected_friend',private:true});
    const reloaded = await build();
    assert.equal(reloaded.resultsHidden, true);
    assert.match(reloaded.feedback, /Run Mutual Checker/);
    await capture(OWNER);
    await evaluate(`(() => {
      const node = ${button('Build my plan')};
      node.scrollIntoView({block:'center',inline:'nearest'});
      node.focus({preventScroll:true});
    })()`);
    assert.equal(await evaluate(`(${rootExpression}).activeElement === ${button('Build my plan')}`), true);
    // sendInputEvent requires a focused BrowserWindow. This fixture is hidden;
    // send real Chromium keyboard input without taking desktop focus instead.
    const keyboardDebuggerAttached = webContents.debugger.isAttached();
    if (!keyboardDebuggerAttached) webContents.debugger.attach('1.3');
    try {
      await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
        type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r',
      });
      await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
        type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,
      });
    } finally {
      if (!keyboardDebuggerAttached && webContents.debugger.isAttached()) webContents.debugger.detach();
    }
    await waitForPageValue(webContents, `(${rootExpression}).activeElement === (${rootExpression}).querySelector('[data-presence="plan-summary"]')`, 'keyboard Build result focus').catch(async error => {
      const detail = await evaluate(`(() => {
        const root = ${rootExpression}, panel = root.querySelector('.presence-routine');
        const active = root.activeElement;
        return {documentFocused:document.hasFocus(), activeTag:active?.tagName, activeText:active?.textContent,
          activeRole:active?.getAttribute('data-presence'), buildHidden:${button('Build my plan')}.hidden,
          buildDisabled:${button('Build my plan')}.disabled, resultsHidden:panel.querySelector('.presence-results').hidden,
          summary:panel.querySelector('[data-presence="plan-summary"]').textContent,
          feedback:panel.querySelector('.presence-results').previousElementSibling.textContent};
      })()`);
      throw new Error(`${error.message} ${JSON.stringify(detail)}`);
    });
    const keyboardPlan = await readState();
    assert.deepEqual(keyboardPlan.targets, ['@followback_friend']);
    assert.equal(keyboardPlan.choicesOpen, false); assert.equal(keyboardPlan.nativeClicks, 0);
    await openChoices();
    const refreshedFocus = await evaluate(`(() => {
      const root = ${rootExpression}, panel = root.querySelector('.presence-routine');
      const field = panel.querySelector('[data-presence="allowance"]');
      field.focus({preventScroll:true});
      const scroll = root.querySelector('.scroll'), before = scroll.scrollTop;
      root.querySelector('[data-role="presence-disclosure"]').dispatchEvent(new Event('toggle'));
      const sameFocus = root.activeElement === field;
      const sameScroll = scroll.scrollTop === before;
      const choicesStayedOpen = panel.querySelector('[data-presence="choices"]').open;
      field.dispatchEvent(new Event('input', {bubbles:true}));
      return {sameFocus,sameScroll,choicesStayedOpen,resultsHidden:panel.querySelector('.presence-results').hidden,
        buildVisible:!${button('Build my plan')}.hidden,fieldRetained:field === panel.querySelector('[data-presence="allowance"]')};
    })()`);
    assert.deepEqual(refreshedFocus, {sameFocus:true,sameScroll:true,choicesStayedOpen:true,resultsHidden:true,buildVisible:true,fieldRetained:true});
    await build();
    checks.push('keyboard Build focuses its result; refresh preserves focus and scrolling; edits invalidate the plan');
    await openChoices();
    checks.push('private preferences survive a reload without a receipt, plan or action authority');

    const viewports = [
      {label:'desktop-dark',width:1200,height:800,zoom:1,theme:'dark'},
      {label:'desktop-light',width:1200,height:800,zoom:1,theme:'light'},
      {label:'narrow',width:320,height:720,zoom:1,theme:'dark'},
      {label:'short',width:900,height:500,zoom:1,theme:'dark'},
      {label:'zoom-200',width:1280,height:900,zoom:2,theme:'dark'},
    ];
    const states = [];
    for (const viewport of viewports) {
      await openChoices();
      webContents.setZoomFactor(1); await resizeViewport(webContents, viewport); webContents.setZoomFactor(viewport.zoom);
      await evaluate(`(() => {
        const root = ${rootExpression}, theme = root.querySelector('[data-preference="theme"]');
        theme.value = ${JSON.stringify(viewport.theme)}; theme.dispatchEvent(new Event('change', {bubbles:true}));
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`);
      await waitForPageValue(webContents, `getComputedStyle((${rootExpression}).querySelector('.panel')).color === ${JSON.stringify(viewport.theme === 'dark' ? 'rgb(243, 243, 243)' : 'rgb(23, 23, 23)')}`, 'Presence rendered theme');
      const metrics = await evaluate(`(async () => {
        const root = ${rootExpression}, panel = root.querySelector('.panel'), routine = root.querySelector('.presence-routine'), scroll = root.querySelector('.scroll');
        const visible = node => node.getClientRects().length && !node.closest('[hidden]');
        const controls = [...routine.querySelectorAll('button,input,textarea,summary')].filter(visible)
          .map(node => node.matches('input[type="checkbox"]') ? node.closest('label') : node);
        const targets = [];
        for (const node of controls) {
          node.scrollIntoView({block:'center',inline:'nearest'});
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const rect = node.getBoundingClientRect(), clip = scroll.getBoundingClientRect();
          const hit = root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          targets.push({name:node.getAttribute('data-presence') || node.textContent.trim(),width:rect.width,height:rect.height,
            left:rect.left,right:rect.right,reachable:rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1,
            hit:hit === node || node.contains(hit)});
        }
        const rect = panel.getBoundingClientRect();
        const overlaps = [...routine.querySelectorAll('.presence-fields')].flatMap(group => {
          const children = [...group.children].filter(visible);
          return children.slice(1).filter((node,i) => node.getBoundingClientRect().top < children[i].getBoundingClientRect().bottom - 1).map(node => node.tagName);
        });
        return {targets,overlaps,width:innerWidth,height:innerHeight,panel:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom},
          overflow:routine.scrollWidth-routine.clientWidth,scrollOverflow:scroll.scrollWidth-scroll.clientWidth,
          liveRegions:root.querySelectorAll('[aria-live]').length};
      })()`);
      assert.ok(metrics.targets.length >= 9, 'Presence form and options are rendered without inactive target selectors');
      assert.ok(metrics.targets.every(target => target.width >= 44 && target.height >= 44), `${viewport.label}: undersized Presence controls ${JSON.stringify(metrics)}`);
      assert.ok(metrics.targets.every(target => target.reachable && target.hit), `${viewport.label}: obscured Presence controls ${JSON.stringify(metrics)}`);
      assert.ok(metrics.targets.every(target => target.left >= metrics.panel.left - 1 && target.right <= metrics.panel.right + 1), 'Presence controls remain inside panel');
      assert.ok(metrics.panel.left >= -1 && metrics.panel.top >= -1 && metrics.panel.right <= metrics.width + 1 && metrics.panel.bottom <= metrics.height + 1);
      assert.ok(metrics.overflow <= 1 && metrics.scrollOverflow <= 1); assert.deepEqual(metrics.overlaps, []); assert.equal(metrics.liveRegions, 1);
      assert.equal(webContents.getZoomFactor(), viewport.zoom);
      if (viewport.zoom === 2) assert.ok(metrics.width <= 650, 'Chromium layout viewport reflects actual 200% zoom');
      const screenshots = [];
      for (const position of ['form','plan']) {
        await evaluate(`(() => {
          const routine = (${rootExpression}).querySelector('.presence-routine');
          routine.querySelector('[data-presence="choices"]').open = ${position === 'form'};
          routine.querySelector(${JSON.stringify(position === 'form' ? '[data-presence="choices"]' : '[data-presence="plan-summary"]')}).scrollIntoView({block:'start',inline:'nearest'});
          return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`);
        await withTimeout(new Promise(resolve => { webContents.once('paint', resolve); webContents.invalidate(); }), 'Presence fresh screenshot');
        const filename = `${viewport.label}-${position}.png`;
        await writeFile(path.join(screenshotRoot, filename), (await webContents.capturePage()).toPNG()); screenshots.push(filename);
      }
      states.push({viewport,metrics,screenshots});
    }
    const requestsBeforeReturn = requests.length;
    await evaluate(`${button('Manual Follow / Unfollow')}.click()`);
    assert.deepEqual(await evaluate(`({closed:!(${rootExpression}).querySelector('[data-role="presence-disclosure"]').open, focus:(${rootExpression}).activeElement?.dataset.role})`),
      {closed:true,focus:'bot-action'});
    assert.equal(requests.length, requestsBeforeReturn); checks.push('manual return closes disclosure and restores composer focus');
    await openPresence(); await build();
    await evaluate(`(${rootExpression}).querySelector('[data-action="clear-capture"]').click()`);
    const cleared = await build(); assert.equal(cleared.resultsHidden, true); assert.match(cleared.feedback, /Run Mutual Checker/);
    checks.push('Clear checker revokes capture');
    await capture(OWNER); await build();
    await evaluate(`document.dispatchEvent(new Event('freeze'))`);
    const frozen = await build(); assert.equal(frozen.resultsHidden, true); assert.match(frozen.feedback, /Run Mutual Checker/);
    checks.push('page freeze revokes capture');
    await capture(OWNER); await build();
    await evaluate(`window.dispatchEvent(new Event('pagehide'))`);
    const hidden = await build(); assert.equal(hidden.resultsHidden, true); assert.match(hidden.feedback, /Run Mutual Checker/);
    checks.push('pagehide revokes capture');
    await writeFile(path.join(screenshotRoot, 'metrics.json'), `${JSON.stringify({fixtureOnly:true,version:releaseVersion,checks,requests,states},null,2)}\n`);
    console.log(`Accepted generated userscript Presence preview: ${checks.length} behavioral gates, ${states.length} rendered states, original checker receipts, zero native actions.`);
  } finally {
    webContents.setZoomFactor(1);
    isolatedSession.protocol.unhandle('https'); isolatedSession.protocol.unhandle('http');
  }
}
