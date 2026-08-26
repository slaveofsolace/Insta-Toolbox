(() => {
  'use strict';

  const modules = globalThis.__instaToolboxOverlayModules;
  const shared = modules?.shared;
  const preferences = modules?.preferences;
  if (!shared || !preferences || modules.layout) return;

  const PRESET_WIDTHS = Object.freeze({ compact: 380, standard: 460, wide: 560 });
  const LAUNCHER_SIZES = Object.freeze({ standard: 44, large: 52 });
  const VIEWPORT_INSET = 8;
  const STACKED_LAYOUT_MAX_WIDTH = 860;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
  }

  function viewportSize(windowLike) {
    return {
      width: Math.max(1, Number(windowLike?.innerWidth) || 1),
      height: Math.max(1, Number(windowLike?.innerHeight) || 1),
    };
  }

  function constrainSize({ width, height }, viewport) {
    const maximumWidth = Math.max(
      preferences.limits.MIN_PANEL_WIDTH,
      Math.min(preferences.limits.MAX_PANEL_WIDTH, viewport.width - (VIEWPORT_INSET * 2)),
    );
    const maximumHeight = Math.max(
      preferences.limits.MIN_PANEL_HEIGHT,
      Math.min(preferences.limits.MAX_PANEL_HEIGHT, viewport.height - (VIEWPORT_INSET * 2)),
    );
    return {
      width: Math.round(clamp(width, preferences.limits.MIN_PANEL_WIDTH, maximumWidth)),
      height: Math.round(clamp(height, preferences.limits.MIN_PANEL_HEIGHT, maximumHeight)),
    };
  }

  function constrainPosition({ x, y }, size, viewport) {
    return {
      x: Math.round(clamp(x, VIEWPORT_INSET, Math.max(VIEWPORT_INSET, viewport.width - size.width - VIEWPORT_INSET))),
      y: Math.round(clamp(y, VIEWPORT_INSET, Math.max(VIEWPORT_INSET, viewport.height - size.height - VIEWPORT_INSET))),
    };
  }

  function create({
    host,
    launcher,
    moveHandle,
    onCommit,
    panel,
    resizeEndHandle,
    resizeStartHandle,
    window: windowLike,
  }) {
    let active = true;
    let interaction = null;
    let suppressLauncherClick = false;
    let current = preferences.defaults();

    function renderedLauncherSize(preferenceValue = current) {
      const side = LAUNCHER_SIZES[preferenceValue.launcherSize] || LAUNCHER_SIZES.standard;
      return { width: side, height: side };
    }

    function renderedSize(preferenceValue = current) {
      const viewport = viewportSize(windowLike);
      const rectangle = panel.getBoundingClientRect();
      const preferredWidth = preferenceValue.panelWidth
        || PRESET_WIDTHS[preferenceValue.width]
        || PRESET_WIDTHS.standard;
      const preferredHeight = preferenceValue.panelHeight
        || rectangle.height
        || Math.min(640, viewport.height - (VIEWPORT_INSET * 2));
      return constrainSize({ width: preferredWidth, height: preferredHeight }, viewport);
    }

    function applyOpacity(value) {
      const opacity = clamp(
        value,
        preferences.limits.MIN_OPACITY,
        preferences.limits.MAX_OPACITY,
      );
      const percent = Math.round(opacity * 100);
      host.style.setProperty('--insta-toolbox-panel-alpha', `${percent}%`);
      host.style.setProperty('--insta-toolbox-panel-alpha-strong', `${Math.min(100, percent + 8)}%`);
    }

    function apply(preferenceValue) {
      current = preferences.normalize(preferenceValue, current);
      const viewport = viewportSize(windowLike);
      const size = renderedSize(current);
      if (current.panelWidth != null) {
        host.style.setProperty('--insta-toolbox-panel-custom-width', `${size.width}px`);
      } else {
        host.style.removeProperty('--insta-toolbox-panel-custom-width');
      }
      if (current.panelHeight != null) {
        host.style.setProperty('--insta-toolbox-panel-custom-height', `${size.height}px`);
      } else {
        host.style.removeProperty('--insta-toolbox-panel-custom-height');
      }
      applyOpacity(current.opacity);

      if (current.launcherPosition) {
        const launcherPosition = constrainPosition(
          current.launcherPosition,
          renderedLauncherSize(current),
          viewport,
        );
        host.dataset.launcherLayout = 'floating';
        host.style.setProperty('--insta-toolbox-launcher-left', `${launcherPosition.x}px`);
        host.style.setProperty('--insta-toolbox-launcher-top', `${launcherPosition.y}px`);
      } else {
        host.dataset.launcherLayout = 'docked';
        host.style.removeProperty('--insta-toolbox-launcher-left');
        host.style.removeProperty('--insta-toolbox-launcher-top');
      }

      if (current.position && viewport.width > STACKED_LAYOUT_MAX_WIDTH) {
        const position = constrainPosition(current.position, size, viewport);
        host.dataset.layout = 'floating';
        host.style.setProperty('--insta-toolbox-panel-left', `${position.x}px`);
        host.style.setProperty('--insta-toolbox-panel-top', `${position.y}px`);
      } else {
        host.dataset.layout = 'docked';
        host.style.removeProperty('--insta-toolbox-panel-left');
        host.style.removeProperty('--insta-toolbox-panel-top');
      }
    }

    function previewOpacity(value) {
      applyOpacity(value);
    }

    function interactionPatch(event) {
      if (!interaction) return null;
      const viewport = viewportSize(windowLike);
      const deltaX = event.clientX - interaction.pointerX;
      const deltaY = event.clientY - interaction.pointerY;
      interaction.moved ||= Math.hypot(deltaX, deltaY) >= 4;
      if (interaction.kind === 'launcher') {
        const size = renderedLauncherSize(current);
        return {
          launcherPosition: constrainPosition({
            x: interaction.rectangle.left + deltaX,
            y: interaction.rectangle.top + deltaY,
          }, size, viewport),
        };
      }
      if (interaction.kind === 'move') {
        const size = constrainSize({
          width: interaction.rectangle.width,
          height: interaction.rectangle.height,
        }, viewport);
        return {
          position: constrainPosition({
            x: interaction.rectangle.left + deltaX,
            y: interaction.rectangle.top + deltaY,
          }, size, viewport),
        };
      }
      const fromStart = interaction.kind === 'resize-start';
      const size = constrainSize({
        width: interaction.rectangle.width + (fromStart ? -deltaX : deltaX),
        height: interaction.rectangle.height + deltaY,
      }, viewport);
      const patch = {
        panelHeight: size.height,
        panelWidth: size.width,
      };
      if (fromStart) {
        patch.position = constrainPosition({
          x: interaction.rectangle.right - size.width,
          y: interaction.rectangle.top,
        }, size, viewport);
      }
      return patch;
    }

    function begin(event, kind) {
      if (!active || event.button !== 0) return;
      if (kind !== 'launcher' && viewportSize(windowLike).width <= STACKED_LAYOUT_MAX_WIDTH) return;
      const rectangle = (kind === 'launcher' ? launcher : panel).getBoundingClientRect();
      interaction = {
        kind,
        moved: false,
        pointerId: event.pointerId,
        pointerX: event.clientX,
        pointerY: event.clientY,
        rectangle,
      };
      host.dataset.layoutInteraction = kind;
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }

    function move(event) {
      if (!active || !interaction || event.pointerId !== interaction.pointerId) return;
      const patch = interactionPatch(event);
      if (patch) apply({ ...current, ...patch });
      event.preventDefault();
    }

    function end(event) {
      if (!interaction || event.pointerId !== interaction.pointerId) return;
      const patch = interactionPatch(event);
      const finished = interaction;
      interaction = null;
      delete host.dataset.layoutInteraction;
      event.currentTarget?.releasePointerCapture?.(event.pointerId);
      if (finished.kind === 'launcher' && !finished.moved) return;
      if (finished.kind === 'launcher') suppressLauncherClick = true;
      if (patch) {
        apply({ ...current, ...patch });
        onCommit?.(patch);
      }
    }

    function keyboardMove(event) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const rectangle = panel.getBoundingClientRect();
      const size = renderedSize(current);
      const step = event.shiftKey ? 40 : 12;
      const delta = {
        x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
        y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
      };
      const position = constrainPosition({
        x: (current.position?.x ?? rectangle.left) + delta.x,
        y: (current.position?.y ?? rectangle.top) + delta.y,
      }, size, viewportSize(windowLike));
      const patch = { position };
      apply({ ...current, ...patch });
      onCommit?.(patch);
      event.preventDefault();
    }

    function keyboardResize(event) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const size = renderedSize(current);
      const step = event.shiftKey ? 40 : 12;
      const next = constrainSize({
        width: size.width + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        height: size.height + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      }, viewportSize(windowLike));
      const patch = { panelHeight: next.height, panelWidth: next.width };
      apply({ ...current, ...patch });
      onCommit?.(patch);
      event.preventDefault();
    }

    function keyboardResizeStart(event) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const rectangle = panel.getBoundingClientRect();
      const size = renderedSize(current);
      const step = event.shiftKey ? 40 : 12;
      const next = constrainSize({
        width: size.width + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
        height: size.height + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      }, viewportSize(windowLike));
      const patch = {
        panelHeight: next.height,
        panelWidth: next.width,
        position: constrainPosition({
          x: rectangle.right - next.width,
          y: rectangle.top,
        }, next, viewportSize(windowLike)),
      };
      apply({ ...current, ...patch });
      onCommit?.(patch);
      event.preventDefault();
    }

    function keyboardLauncherMove(event) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const rectangle = launcher.getBoundingClientRect();
      const step = event.shiftKey ? 40 : 12;
      const size = renderedLauncherSize(current);
      const patch = {
        launcherPosition: constrainPosition({
          x: (current.launcherPosition?.x ?? rectangle.left)
            + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
          y: (current.launcherPosition?.y ?? rectangle.top)
            + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
        }, size, viewportSize(windowLike)),
      };
      apply({ ...current, ...patch });
      onCommit?.(patch);
      event.preventDefault();
    }

    function consumeLauncherClick(event) {
      if (!suppressLauncherClick) return;
      suppressLauncherClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function constrain() {
      if (!active) return;
      const previousPosition = current.position;
      const previousLauncherPosition = current.launcherPosition;
      apply(current);
      if (previousLauncherPosition) {
        const launcherPosition = constrainPosition(
          previousLauncherPosition,
          renderedLauncherSize(current),
          viewportSize(windowLike),
        );
        if (
          launcherPosition.x !== previousLauncherPosition.x
          || launcherPosition.y !== previousLauncherPosition.y
        ) {
          apply({ ...current, launcherPosition });
          onCommit?.({ launcherPosition });
        }
      }
      if (!previousPosition || viewportSize(windowLike).width <= STACKED_LAYOUT_MAX_WIDTH) return;
      const size = renderedSize(current);
      const position = constrainPosition(previousPosition, size, viewportSize(windowLike));
      if (position.x !== previousPosition.x || position.y !== previousPosition.y) {
        apply({ ...current, position });
        onCommit?.({ position });
      }
    }

    const beginMove = (event) => begin(event, 'move');
    const beginLauncherMove = (event) => begin(event, 'launcher');
    const beginResizeEnd = (event) => begin(event, 'resize-end');
    const beginResizeStart = (event) => begin(event, 'resize-start');
    launcher?.addEventListener('pointerdown', beginLauncherMove);
    launcher?.addEventListener('keydown', keyboardLauncherMove);
    launcher?.addEventListener('click', consumeLauncherClick, true);
    moveHandle?.addEventListener('pointerdown', beginMove);
    resizeEndHandle?.addEventListener('pointerdown', beginResizeEnd);
    resizeStartHandle?.addEventListener('pointerdown', beginResizeStart);
    moveHandle?.addEventListener('keydown', keyboardMove);
    resizeEndHandle?.addEventListener('keydown', keyboardResize);
    resizeStartHandle?.addEventListener('keydown', keyboardResizeStart);
    windowLike.addEventListener('pointermove', move, { passive: false });
    windowLike.addEventListener('pointerup', end);
    windowLike.addEventListener('pointercancel', end);

    return Object.freeze({
      apply,
      constrain,
      previewOpacity,
      teardown() {
        if (!active) return;
        active = false;
        launcher?.removeEventListener('pointerdown', beginLauncherMove);
        launcher?.removeEventListener('keydown', keyboardLauncherMove);
        launcher?.removeEventListener('click', consumeLauncherClick, true);
        moveHandle?.removeEventListener('pointerdown', beginMove);
        resizeEndHandle?.removeEventListener('pointerdown', beginResizeEnd);
        resizeStartHandle?.removeEventListener('pointerdown', beginResizeStart);
        moveHandle?.removeEventListener('keydown', keyboardMove);
        resizeEndHandle?.removeEventListener('keydown', keyboardResize);
        resizeStartHandle?.removeEventListener('keydown', keyboardResizeStart);
        windowLike.removeEventListener('pointermove', move);
        windowLike.removeEventListener('pointerup', end);
        windowLike.removeEventListener('pointercancel', end);
      },
    });
  }

  shared.install('layout', {
    PRESET_WIDTHS,
    LAUNCHER_SIZES,
    STACKED_LAYOUT_MAX_WIDTH,
    VIEWPORT_INSET,
    constrainPosition,
    constrainSize,
    create,
  });
})();
