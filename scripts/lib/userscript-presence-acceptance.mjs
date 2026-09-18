import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OWNER = 'fixture.owner';
const rootExpression = `document.querySelector('#insta-toolbox-userscript-root').shadowRoot`;

async function trustedClick(webContents, elementExpression, label) {
  const point = await webContents.executeJavaScript(`(() => {
    const target = ${elementExpression};
    if (!(target instanceof HTMLElement) || target.hidden || target.disabled) return null;
    target.scrollIntoView({block:'center',inline:'center'});
    const rect = target.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      ? {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)} : null;
  })()`, true);
  assert.ok(point, `${label} is not available for trusted input`);
  webContents.focus();
  webContents.sendInputEvent({type:'mouseMove',x:point.x,y:point.y});
  webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button:'left',clickCount:1});
  webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y,button:'left',clickCount:1});
  await new Promise(resolve => setTimeout(resolve, 50));
}

function fixturePrelude() {
  return `<script>
    history.replaceState({}, '', '/');
    const rail = document.createElement('nav');
    rail.innerHTML = '<a role="link" href="/">Home</a><a role="link" href="/reels/">Reels</a><a role="link" href="/direct/inbox/">Inbox</a><a role="link" href="/${OWNER}/"><img alt="${OWNER}&#39;s profile picture" width="24" height="24" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22/%3E"></a>';
    document.body.append(rail);
    globalThis.fixturePresenceClicks = [];
    globalThis.fixturePresenceSurface = mode => {
      history.replaceState({}, '', '/');
      const main = document.querySelector('main');
      if (mode === 'post') main.innerHTML = '<article><a href="/p/post-1/">Post</a><button aria-label="Like" type="button">Like</button></article>';
      if (mode === 'follow') main.innerHTML = '<section><a href="/new_friend/">new_friend</a><button aria-label="Follow" type="button">Follow</button></section>';
      if (mode === 'private-follow') main.innerHTML = '<section data-private-profile><a href="/private_friend/">private_friend</a><button aria-label="Follow" type="button">Follow</button></section>';
      if (mode === 'request') main.innerHTML = '<section><a href="/request_friend/">request_friend</a><button aria-label="Confirm" type="button">Confirm</button></section>';
      if (mode === 'story') main.innerHTML = '<a href="/stories/story_friend/story-1/">story_friend story</a>';
    };
    globalThis.fixturePresenceSurface('post');
    document.addEventListener('click', event => {
      const control = event.target.closest('a,button,[role="button"]');
      if (!control) return;
      const name = control.getAttribute('aria-label') || control.textContent.trim();
      if (name === 'Like') {
        control.setAttribute('aria-label', 'Unlike'); control.textContent = 'Unlike';
        globalThis.fixturePresenceClicks.push(location.pathname.startsWith('/stories/') ? 'reactStories' : 'likePosts');
      } else if (name === 'Follow') {
        const result = control.closest('[data-private-profile]') ? 'Requested' : 'Following';
        control.setAttribute('aria-label', result); control.textContent = result;
        globalThis.fixturePresenceClicks.push('followPeople');
      } else if (name === 'Confirm') {
        control.setAttribute('aria-label', 'Following'); control.textContent = 'Following';
        globalThis.fixturePresenceClicks.push('acceptRequests');
      } else if (control.matches('a[href^="/stories/"]')) {
        event.preventDefault();
        history.replaceState({}, '', control.getAttribute('href'));
        document.querySelector('main').innerHTML = '<img alt="Story" width="320" height="480" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22480%22/%3E"><button aria-label="Like" type="button">Like</button><button aria-label="Pause" type="button">Pause</button>';
        globalThis.fixturePresenceClicks.push('viewStories');
      }
    }, true);
  </script>`;
}

export async function acceptUserscriptPresence({
  window, isolatedSession, fixtureAssets, resultsRoot, releaseVersion,
  withTimeout, waitForPageValue, resizeViewport,
}) {
  const webContents = window.webContents;
  const checks = [];
  const screenshotRoot = path.join(resultsRoot, 'userscript-presence');
  await mkdir(screenshotRoot, { recursive: true });
  await isolatedSession.protocol.handle('http', () => new Response('', { status: 403 }));
  await isolatedSession.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.origin !== 'https://www.instagram.com') return new Response('', { status: 403 });
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
  const load = async () => {
    await withTimeout(webContents.loadURL('https://www.instagram.com/userscript-fixture.html'), 'Presence userscript fixture');
    await waitForPageValue(webContents, `Boolean(${rootExpression}?.querySelector('.presence-session'))`, 'Presence session panel');
    await evaluate(`(() => {
      const root = ${rootExpression};
      if (root.querySelector('.panel').hidden) root.querySelector('.launcher').click();
      root.querySelector('[data-view="account"]').click();
    })()`);
  };
  const select = (actions, maxActions = 1) => evaluate(`(() => {
    const root = ${rootExpression};
    for (const input of root.querySelectorAll('[data-presence-action]')) {
      input.checked = ${JSON.stringify(actions)}.includes(input.getAttribute('data-presence-action'));
      input.dispatchEvent(new Event('change', {bubbles:true}));
    }
    const limit = root.querySelector('[data-presence-limit]');
    limit.value = ${JSON.stringify(String(maxActions))};
    limit.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  const startAndConfirm = async expectedAction => {
    const before = await evaluate('globalThis.fixturePresenceClicks.length');
    await evaluate(`${rootExpression}.querySelector('.presence-session .button.primary.big').click()`);
    await waitForPageValue(webContents, `${rootExpression}.querySelector('[data-role="action-confirmation"]')?.open === true`, 'Presence review dialog');
    assert.equal(await evaluate('globalThis.fixturePresenceClicks.length'), before, 'Presence cannot act before confirmation');
    const facts = await evaluate(`(() => {
      const root=${rootExpression}, dialog=root.querySelector('[data-role="action-confirmation"]');
      return {text:dialog.textContent,confirm:dialog.querySelector('[data-action="confirm-accept"]').textContent};
    })()`);
    assert.ok(facts.text.includes(`@${OWNER}`));
    assert.equal(facts.confirm, 'Start Presence');
    await trustedClick(webContents, `${rootExpression}.querySelector('[data-action="confirm-accept"]')`, 'Presence confirmation');
    await waitForPageValue(webContents,
      `globalThis.fixturePresenceClicks.length > ${before} && globalThis.fixturePresenceClicks.at(-1) === ${JSON.stringify(expectedAction)}`,
      `Presence ${expectedAction}`);
    await waitForPageValue(webContents, `${rootExpression}.querySelector('.presence-status strong')?.textContent === 'Presence finished'`, 'Presence completion');
  };
  try {
    await load();
    const layout = await evaluate(`(() => {
      const root=${rootExpression}, panel=root.querySelector('.presence-session');
      return {tab:root.querySelector('[data-view="account"]').textContent,
        labels:[...panel.querySelectorAll('.presence-option')].map(node=>node.textContent.trim()),
        plans:panel.textContent.includes('Build my plan') || panel.textContent.includes('Plan choices'),
        manual:root.querySelector('[data-role="manual-account-disclosure"]')?.textContent.includes('Manual Follow / Unfollow'),
        liveRegions:root.querySelectorAll('[aria-live]').length};
    })()`);
    assert.equal(layout.tab, 'Presence');
    assert.deepEqual(layout.labels, ['View stories','React to stories','Like posts','Follow people','Accept incoming requests']);
    assert.equal(layout.plans, false);
    assert.equal(layout.manual, true);
    assert.equal(layout.liveRegions, 1, 'the toolbox keeps one polite live region');
    checks.push('simple Presence choices replace plan-building UI');

    await select(['likePosts']);
    await startAndConfirm('likePosts');
    assert.deepEqual(await evaluate('globalThis.fixturePresenceClicks'), ['likePosts']);
    checks.push('confirmed post Like is re-resolved and verified');

    await evaluate(`globalThis.fixturePresenceSurface('follow')`);
    await select(['followPeople']);
    await startAndConfirm('followPeople');
    checks.push('confirmed Follow is verified as Following');

    await evaluate(`globalThis.fixturePresenceSurface('private-follow')`);
    await select(['followPeople']);
    await startAndConfirm('followPeople');
    assert.equal(await evaluate(`document.querySelector('[data-private-profile] button')?.getAttribute('aria-label')`), 'Requested');
    checks.push('private-profile Follow is verified as Requested');

    await evaluate(`globalThis.fixturePresenceSurface('request')`);
    await select(['acceptRequests']);
    await startAndConfirm('acceptRequests');
    checks.push('confirmed follow request is verified');

    await evaluate(`globalThis.fixturePresenceSurface('story')`);
    await select(['reactStories'], 2);
    assert.deepEqual(await evaluate(`(() => {
      const root=${rootExpression}; return {
        view:root.querySelector('[data-presence-action="viewStories"]').checked,
        react:root.querySelector('[data-presence-action="reactStories"]').checked};
    })()`), {view:true,react:true}, 'story reactions also require story viewing');
    await startAndConfirm('reactStories');
    assert.deepEqual((await evaluate('globalThis.fixturePresenceClicks')).slice(-2), ['viewStories','reactStories']);
    checks.push('story opens before its reaction and both outcomes are verified');

    await evaluate(`globalThis.fixturePresenceSurface('post')`);
    await select(['likePosts'], 2);
    await evaluate(`${rootExpression}.querySelector('.presence-session .button.primary.big').click()`);
    await waitForPageValue(webContents, `${rootExpression}.querySelector('[data-role="action-confirmation"]')?.open === true`, 'Presence cancel dialog');
    const countBeforeCancel = await evaluate('globalThis.fixturePresenceClicks.length');
    await evaluate(`${rootExpression}.querySelector('[data-action="confirm-cancel"]').click()`);
    assert.equal(await evaluate('globalThis.fixturePresenceClicks.length'), countBeforeCancel);
    checks.push('cancel changes nothing');

    const viewports = [
      {label:'desktop-dark',width:1200,height:800,zoom:1,theme:'dark'},
      {label:'desktop-light',width:1200,height:800,zoom:1,theme:'light'},
      {label:'narrow',width:320,height:720,zoom:1,theme:'dark'},
      {label:'short',width:900,height:500,zoom:1,theme:'dark'},
      {label:'zoom-200',width:1280,height:900,zoom:2,theme:'dark'},
    ];
    const states = [];
    for (const viewport of viewports) {
      webContents.setZoomFactor(1);
      await resizeViewport(webContents, viewport);
      webContents.setZoomFactor(viewport.zoom);
      await evaluate(`(() => {
        const root=${rootExpression}, theme=root.querySelector('[data-preference="theme"]');
        theme.value=${JSON.stringify(viewport.theme)}; theme.dispatchEvent(new Event('change',{bubbles:true}));
        return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      })()`);
      await waitForPageValue(webContents, `(() => {
        const root=${rootExpression}, box=root.querySelector('.panel').getBoundingClientRect();
        return box.left>=-1&&box.top>=-1&&box.right<=innerWidth+1&&box.bottom<=innerHeight+1;
      })()`, `${viewport.label} Presence viewport clamp`);
      const metrics = await evaluate(`(() => {
        const root=${rootExpression}, panel=root.querySelector('.panel'), session=root.querySelector('.presence-session'), scroll=root.querySelector('.scroll');
        const box=panel.getBoundingClientRect();
        const visible=node=>node.getClientRects().length&&!node.closest('[hidden]');
        const controls=[...session.querySelectorAll('button,input[type="number"],label.presence-option')].filter(visible).map(node=>{
          const rect=node.getBoundingClientRect(); return {width:rect.width,height:rect.height,left:rect.left,right:rect.right};
        });
        return {controls,overflow:session.scrollWidth-session.clientWidth,scrollOverflow:scroll.scrollWidth-scroll.clientWidth,
          panel:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},viewport:{width:innerWidth,height:innerHeight}};
      })()`);
      assert.ok(metrics.controls.length >= 7);
      assert.ok(metrics.controls.every(control=>control.width>=44&&control.height>=44), `${viewport.label}: undersized Presence control`);
      assert.ok(metrics.controls.every(control=>control.left>=metrics.panel.left-1&&control.right<=metrics.panel.right+1), `${viewport.label}: horizontal overflow`);
      assert.ok(metrics.overflow<=1&&metrics.scrollOverflow<=1, `${viewport.label}: unexpected overflow`);
      assert.ok(
        metrics.panel.left>=-1&&metrics.panel.top>=-1&&metrics.panel.right<=metrics.viewport.width+1&&metrics.panel.bottom<=metrics.viewport.height+1,
        `${viewport.label}: panel outside viewport ${JSON.stringify(metrics)}`,
      );
      await withTimeout(new Promise(resolve => { webContents.once('paint', resolve); webContents.invalidate(); }), 'Presence screenshot paint');
      const filename=`${viewport.label}.png`;
      await writeFile(path.join(screenshotRoot, filename), (await webContents.capturePage()).toPNG());
      states.push({viewport,metrics,screenshot:filename});
    }
    checks.push('responsive layout and true 200% zoom');
    await writeFile(path.join(screenshotRoot, 'metrics.json'), `${JSON.stringify({fixtureOnly:true,version:releaseVersion,checks,states},null,2)}\n`);
    console.log(`Accepted generated userscript Presence session: ${checks.length} gates and ${states.length} rendered states.`);
  } finally {
    webContents.setZoomFactor(1);
    isolatedSession.protocol.unhandle('https');
    isolatedSession.protocol.unhandle('http');
  }
}
