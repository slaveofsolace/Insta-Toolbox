(() => {
  'use strict';

  const modules = globalThis.__instaToolboxOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.nowView) return;

  function make(document, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function addFact(document, list, label, value) {
    const wrapper = document.createElement('div');
    const term = make(document, 'dt', '', label);
    const description = make(document, 'dd', '', value);
    wrapper.append(term, description);
    list.append(wrapper);
  }

  function routeCopy(context) {
    if (context?.pageKind === 'profile') {
      const relationship = context.profile?.ambiguous
        ? 'Ambiguous — safe stop'
        : shared.safeText(context.profile?.relationship, 'Not resolved');
      return {
        badge: relationship,
        heading: context.username ? `@${context.username}` : 'Profile not resolved',
        nextAction: 'Refresh profile status',
        nextDetail: 'Checks the relationship without clicking Follow or Unfollow.',
        nextCommand: 'refresh-context',
        subtitle: 'Profile review',
      };
    }
    if (context?.pageKind === 'messages') {
      return {
        badge: 'read only',
        heading: 'Open conversation',
        nextAction: 'Read visible messages',
        nextDetail: 'Reads the open conversation without opening a message menu.',
        nextCommand: 'inspect-messages',
        subtitle: 'Message evidence',
      };
    }
    return {
      badge: shared.safeText(context?.pageKind, 'waiting'),
      heading: 'No exact target on this route',
      nextAction: 'Refresh page context',
      nextDetail: 'Account and message actions stay unavailable until an exact target is open.',
      nextCommand: 'refresh-context',
      subtitle: 'Instagram context',
    };
  }

  function render(runtime) {
    const { document, model, query } = runtime;
    const content = query('[data-insta-toolbox-role="now-content"]');
    if (!content) return;
    content.replaceChildren();

    const context = model.context || {};
    const [stateTitle, stateDetail, stateTone] = shared.sessionState(context);
    const state = make(document, 'div', 'insta-toolbox-state-row');
    state.dataset.tone = stateTone;
    const stateDot = make(document, 'span', 'insta-toolbox-state-dot');
    stateDot.setAttribute('aria-hidden', 'true');
    const stateCopy = document.createElement('div');
    stateCopy.append(
      make(document, 'strong', '', stateTitle),
      make(document, 'span', '', stateDetail),
    );
    state.append(stateDot, stateCopy);

    const copy = routeCopy(context);
    const card = make(document, 'article', 'insta-toolbox-card');
    const targetTop = make(document, 'div', 'insta-toolbox-target-top');
    const avatar = make(document, 'div', 'insta-toolbox-target-avatar', context.username ? '@' : 'IG');
    avatar.setAttribute('aria-hidden', 'true');
    const targetCopy = document.createElement('div');
    targetCopy.append(
      make(document, 'h2', '', copy.heading),
      make(document, 'p', '', copy.subtitle),
    );
    const badge = make(document, 'span', 'insta-toolbox-badge', copy.badge);
    badge.dataset.tone = context.profile?.ambiguous
      ? 'danger'
      : context.pageKind === 'profile'
        && context.profile?.profileIdentityVerified
        && context.profile?.relationship
        ? 'good'
        : 'neutral';
    targetTop.append(avatar, targetCopy, badge);

    const facts = make(document, 'dl', 'insta-toolbox-facts');
    const queueItem = shared.currentQueueItem(model);
    const queueMatch = queueItem && context.username === queueItem.account.username
      ? `Ready to ${queueItem.action}`
      : queueItem
        ? `Next @${queueItem.account.username}`
        : 'No queued account';
    const pageLabel = context.pageKind === 'profile'
      ? 'Profile'
      : context.pageKind === 'messages'
        ? 'Conversation'
        : 'Instagram page';
    addFact(document, facts, 'Page', pageLabel);
    addFact(document, facts, 'Queue', queueMatch);
    card.append(targetTop, facts);

    const next = make(document, 'section', 'insta-toolbox-next');
    const nextCopy = document.createElement('div');
    nextCopy.append(make(document, 'p', '', copy.nextDetail));
    const button = make(document, 'button', 'insta-toolbox-button', copy.nextAction);
    button.type = 'button';
    button.dataset.instaToolboxAction = copy.nextCommand;
    next.append(nextCopy, button);

    const toolHeading = make(document, 'h2', 'insta-toolbox-tool-heading', 'Tools');
    const toolGrid = make(document, 'div', 'insta-toolbox-tool-grid');
    const tools = [
      {
        section: 'capture',
        title: 'Mutual Checker',
        detail: 'Compare Followers and Following.',
        state: 'read only',
      },
      {
        section: 'queue',
        title: 'Follow / Unfollow',
        detail: 'Review exact accounts before starting.',
        state: model.bridge.pendingLiveIntent ? 'intent ready' : 'review then confirm',
      },
      {
        section: 'messages',
        title: 'DM Unsend',
        detail: 'Unsend messages from the open conversation.',
        state: model.bridge.pendingDmIntent ? 'intent ready' : 'scan then confirm',
      },
    ];
    for (const tool of tools) {
      const button = make(document, 'button', 'insta-toolbox-tool-card');
      button.type = 'button';
      button.dataset.instaToolboxGoSection = tool.section;
      const copyElement = document.createElement('span');
      copyElement.append(
        make(document, 'strong', '', tool.title),
        make(document, 'span', '', tool.detail),
      );
      button.append(copyElement, make(document, 'em', '', tool.state));
      toolGrid.append(button);
    }
    content.append(state, card, next, toolHeading, toolGrid);
  }

  shared.install('nowView', { render });
})();
