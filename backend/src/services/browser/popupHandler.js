const REJECT = /^(reject( all)?|decline( all)?|deny|only necessary|necessary only|essential only|manage.*reject)$/i;
const CLOSE = /^(close|dismiss|no thanks|not now|maybe later|skip|×|✕)$/i;
const UNSAFE = /accept|agree|allow all|consent|subscribe|sign up|opt.?in|yes/i;

export function chooseSafePopupAction(candidates = []) {
  const clean = candidates.map((candidate) => ({ ...candidate, text: String(candidate.text ?? '').replace(/\s+/g, ' ').trim() })).filter((candidate) => candidate.visible !== false && candidate.text && !UNSAFE.test(candidate.text));
  return clean.find((candidate) => REJECT.test(candidate.text)) ?? clean.find((candidate) => CLOSE.test(candidate.text)) ?? null;
}

export async function closeCommonPopups({ page, maxPasses = 3, waitBetweenPasses = 150 } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  const actions = [];
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const action = await page.evaluate(({ rejectSource, closeSource, unsafeSource }) => {
      const reject = new RegExp(rejectSource, 'i'); const close = new RegExp(closeSource, 'i'); const unsafe = new RegExp(unsafeSource, 'i');
      const controls = [...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"],a')].map((element) => ({ element, text: String(element.innerText || element.value || element.getAttribute('aria-label') || element.title || '').replace(/\s+/g, ' ').trim(), visible: Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length) }));
      const safe = controls.filter((item) => item.visible && item.text && !unsafe.test(item.text));
      const selected = safe.find((item) => reject.test(item.text)) || safe.find((item) => close.test(item.text));
      if (!selected) return null; selected.element.click(); return { text: selected.text, type: reject.test(selected.text) ? 'reject' : 'close' };
    }, { rejectSource: REJECT.source, closeSource: CLOSE.source, unsafeSource: UNSAFE.source });
    if (!action) break; actions.push(action);
    if (waitBetweenPasses > 0) await new Promise((resolve) => setTimeout(resolve, waitBetweenPasses));
  }
  return { handled: actions.length, actions };
}
