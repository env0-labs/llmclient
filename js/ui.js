export const $ = (id) => document.getElementById(id);

export function renderMarkdown(target, text) {
  if (!target) return;
  if (!window.marked) {
    target.textContent = text;
    return;
  }
  target.innerHTML = marked.parse(text);
}

export function setBusy(isBusy, { disableOnBusy = [], enableOnBusy = [] } = {}) {
  disableOnBusy.forEach((el) => {
    if (el) el.disabled = isBusy;
  });
  enableOnBusy.forEach((el) => {
    if (el) el.disabled = !isBusy;
  });
}
