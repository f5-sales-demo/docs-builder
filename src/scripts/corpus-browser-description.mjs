const invisibleCharacters = /[\u200B-\u200D\uFEFF]/g;
const captureDatePrefix =
  /^(?:Published|Last modified|Last updated|Updated)\s+(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:0?[1-9]|[12]\d|3[01]),\s+\d{4}|\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))(?:\s*\|\s*|\.?\s+|$)/i;

/** Format a browser card without altering reviewed corpus metadata or leaves. */
export function corpusBrowserDescription(description, title) {
  let visible = (description ?? '').replace(invisibleCharacters, '').trim();
  while (captureDatePrefix.test(visible)) {
    visible = visible.replace(captureDatePrefix, '').trim();
  }
  return /[\p{Letter}\p{Number}]/u.test(visible) ? visible : `Documentation for ${title}.`;
}
