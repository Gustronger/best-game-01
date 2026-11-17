// LANTERNFALL input — translates DOM events into game callbacks only.
// Mouse clicks become canvas coordinates (the canvas may be CSS-scaled),
// mouse moves become hover positions, keys become named actions. No game
// logic lives here: main.js decides what each callback means.
export function createInput(canvas, handlers) {
  const h = handlers || {};

  function toCanvas(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width ? canvas.width / rect.width : 1;
    const scaleY = rect.height ? canvas.height / rect.height : 1;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function onClick(event) {
    if (!h.onClick) return;
    const pos = toCanvas(event);
    h.onClick(pos.x, pos.y);
  }

  function onMove(event) {
    if (!h.onHover) return;
    const pos = toCanvas(event);
    h.onHover(pos.x, pos.y);
  }

  function onLeave() {
    if (h.onHover) h.onHover(null);
  }

  function onKey(event) {
    if (!h.onKey) return;
    let action = null;
    switch (event.code) {
      case 'Digit1':
      case 'Numpad1':
        action = 'select-ember';
        break;
      case 'Digit2':
      case 'Numpad2':
        action = 'select-frost';
        break;
      case 'Digit3':
      case 'Numpad3':
        action = 'select-storm';
        break;
      case 'Space':
      case 'KeyP':
        action = 'pause';
        event.preventDefault();
        break;
      case 'Escape':
        action = 'deselect';
        break;
      case 'Enter':
        action = 'send-wave';
        break;
      case 'KeyM':
        action = 'mute';
        break;
      case 'KeyR':
        action = 'restart';
        break;
      default:
        return;
    }
    if (event.repeat) return;
    h.onKey(action);
  }

  function onBlur() {
    if (h.onHover) h.onHover(null);
  }

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  window.addEventListener('keydown', onKey);
  window.addEventListener('blur', onBlur);

  return {
    destroy() {
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    },
  };
}
