import { renderRunnable, substitute } from '../lib/personalization.mjs';
import { getAllValues, loadValues, placeholderDefs, subscribe } from '../lib/placeholder-store';

const originals = new WeakMap<Node, string>();
const saved = (node: Node) => {
  if (!originals.has(node)) originals.set(node, node.textContent ?? '');
  return originals.get(node) ?? '';
};
function update(values: Record<string, string>) {
  const content = document.querySelector('.sl-markdown-content');
  if (!content) return;
  content.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
    if (pre.closest('[data-personalize="off"]') || pre.closest('.mermaid-container')) return;
    const code = pre.querySelector('code');
    if (!code) return;
    const template = saved(code);
    const wrapper = pre.closest<HTMLElement>('.expressive-code') ?? pre;
    const button = wrapper.querySelector<HTMLButtonElement>('button[data-code]');
    const annotation = pre.closest<HTMLElement>('[data-xcsh-context], [data-xcsh-fields], [data-xcsh-render]');
    const source = annotation?.dataset.xcshSource;
    const raw = source
      ? new TextDecoder().decode(Uint8Array.from(atob(source), (c) => c.charCodeAt(0)))
      : button
        ? savedButton(button).replaceAll(String.fromCharCode(127), String.fromCharCode(10))
        : template;
    const required = (annotation?.dataset.xcshFields ?? '').split(/[\s,]+/).filter(Boolean);
    const context =
      annotation?.dataset.xcshContext ??
      (/\b(?:json)\b/.test(pre.dataset.language ?? code.className)
        ? 'json'
        : /\b(?:hcl|terraform)\b/.test(pre.dataset.language ?? code.className)
          ? 'hcl'
          : /\b(?:bash|sh|shell)\b/.test(pre.dataset.language ?? code.className)
            ? 'shell'
            : 'text');
    const mode = annotation?.dataset.xcshRender ?? 'legacy';
    const rendered =
      context === 'shell' && (required.length || mode !== 'legacy')
        ? renderRunnable(raw, required, values, { mode, fields: placeholderDefs })
        : substitute(raw, values, context);
    if (rendered !== template || code.hasAttribute('data-personalized')) {
      code.textContent = rendered;
      code.style.display = 'block';
      code.style.whiteSpace = 'pre';
      code.setAttribute('data-personalized', '');
    }
    if (button) button.setAttribute('data-code', rendered.replaceAll('\n', '\x7f'));
    if (mode === 'script' && annotation?.dataset.xcshDownload) {
      let download = annotation.querySelector<HTMLButtonElement>('button[data-personalized-download]');
      if (!download) {
        download = document.createElement('button');
        download.className = "ph-reset";
        download.type = 'button';
        download.setAttribute('data-personalized-download', '');
        download.textContent = 'Download personalized script';
        annotation.append(download);
      }
      download.onclick = () => {
        const source = renderRunnable(raw, required, getAllValues(loadValues()), {
          mode: 'script',
          fields: placeholderDefs,
        });
        const url = URL.createObjectURL(new Blob([source], { type: 'text/x-shellscript;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = annotation.dataset.xcshDownload ?? 'personalized.sh';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
    }
  });
  // Prose and inline code use text nodes, never HTML interpolation.
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  node = walker.nextNode();
  while (node) {
    const currentNode = node;
    node = walker.nextNode();
    const parent = (currentNode as Text).parentElement;
    if (!parent || parent.closest('pre,script,style,svg,.mermaid-container,[data-personalize="off"]')) continue;
    const template = saved(currentNode);
    currentNode.textContent = substitute(template, values, 'text');
  }
  renderDiagrams(values);
}
function savedButton(button: HTMLButtonElement) {
  if (!button.hasAttribute('data-code-template'))
    button.setAttribute('data-code-template', button.getAttribute('data-code') ?? '');
  return button.getAttribute('data-code-template') ?? '';
}
let generation = 0;
async function renderDiagrams(values: Record<string, string>) {
  const containers = [...document.querySelectorAll<HTMLElement>('.mermaid-container')].filter(
    (c) => !c.closest('[data-personalize="off"]'),
  );
  if (!containers.length) return;
  const current = ++generation;
  const mermaid = (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
  for (const [i, container] of containers.entries()) {
    const template = container.getAttribute('data-mermaid-src') ?? '';
    try {
      const { svg } = await mermaid.render('ph-diagram-' + current + '-' + i, substitute(template, values, 'mermaid'));
      if (current === generation) container.innerHTML = svg;
    } catch {
      if (current === generation) container.textContent = 'Diagram unavailable';
    }
  }
}
function init() {
  update(getAllValues(loadValues()));
}
document.addEventListener('placeholder-change', (event) => update((event as CustomEvent).detail));
subscribe(init);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
document.addEventListener('astro:page-load', init);
