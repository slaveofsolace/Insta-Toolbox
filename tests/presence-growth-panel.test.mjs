import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPresenceGrowthPanel } from '../extension/presence-growth-panel.js';

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.listeners = {};
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map((child) => child.textContent).join(''); }
  setAttribute() {}
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = [...children]; this.text = ''; }
  querySelectorAll(selector) {
    const all = this.children.flatMap((node) => [node, ...node.querySelectorAll?.('*') || []]);
    if (selector === '*') return all;
    if (selector === 'input:checked') return all.filter((node) => node.tagName === 'input' && node.checked);
    return [];
  }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  remove() {}
}

function fixture() {
  let clock = 100 * 86_400_000;
  let campaigns = [];
  let viewer = { accountVerified: true, usable: true, accountId: 'owner' };
  let approval = true;
  const runs = [];
  const scans = [];
  const document = { createElement: (tag) => new Element(tag), createTextNode: (text) => {
    const node = new Element('#text'); node.textContent = text; return node;
  } };
  const container = document.createElement('div');
  const panel = mountPresenceGrowthPanel({ container, document,
    inspectAccount: () => viewer,
    readFollowing: () => ['seed', 'already'],
    readFollowers: () => [],
    scanSeed: async (username) => { scans.push(username); return {
      followers: ['candidate', 'already'], following: ['candidate', 'already', 'one_way'],
    }; },
    readCampaigns: () => campaigns,
    writeCampaigns: (value) => { campaigns = value; },
    confirmAction: async ({ binding }) => approval ? binding : null,
    runBatch: async (run) => { runs.push(run); },
    now: () => clock,
  });
  const all = () => container.querySelectorAll('*');
  const input = all().find((node) => node.tagName === 'input' && node.type === 'text');
  const select = all().find((node) => node.tagName === 'select');
  return { panel, runs, scans, campaigns: () => campaigns, input, select,
    setClock: (value) => { clock = value; },
    setViewer: (value) => { viewer = value; },
    setApproval: (value) => { approval = value; },
  };
}

test('growth panel scans selected following and submits only reviewed positive candidates', async () => {
  const app = fixture();
  app.input.value = '@seed';
  await app.panel.findCandidates();
  assert.deepEqual(app.scans, ['seed']);
  app.select.value = '9';
  await app.panel.reviewFollow();
  assert.equal(app.runs.length, 1);
  assert.deepEqual(app.runs[0].usernames, ['candidate']);
  assert.equal(app.runs[0].action, 'follow');
  assert.equal(app.campaigns()[0].delayDays, 9);
});

test('cancel never creates a campaign or dispatches a Follow', async () => {
  const app = fixture();
  app.input.value = 'seed';
  await app.panel.findCandidates();
  app.setApproval(false);
  await app.panel.reviewFollow();
  assert.equal(app.runs.length, 0);
  assert.deepEqual(app.campaigns(), []);
});

test('a seed outside captured Following never starts a network scan', async () => {
  const app = fixture();
  app.input.value = 'stranger';
  await app.panel.findCandidates();
  assert.deepEqual(app.scans, []);
  assert.equal(app.runs.length, 0);
});

test('unfollow review requires a verified Follow and the due date on the same account', async () => {
  const app = fixture();
  app.input.value = 'seed';
  await app.panel.findCandidates();
  await app.panel.reviewFollow();
  const campaign = app.campaigns()[0];
  await app.panel.reviewDue();
  assert.equal(app.runs.length, 1);
  app.campaigns()[0] = { ...campaign, followed: { candidate: 100 * 86_400_000 } };
  app.setClock(109 * 86_400_000);
  app.setViewer({ accountVerified: true, usable: true, accountId: 'other' });
  await app.panel.reviewDue();
  assert.equal(app.runs.length, 1);
  app.setViewer({ accountVerified: true, usable: true, accountId: 'owner' });
  await app.panel.reviewDue();
  assert.equal(app.runs.length, 2);
  assert.equal(app.runs[1].action, 'unfollow');
  assert.deepEqual(app.runs[1].usernames, ['candidate']);
});
