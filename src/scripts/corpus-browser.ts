interface CorpusNode {
  route: string;
  type: 'directory' | 'leaf';
  title: string;
  description: string;
  href: string;
  children: string[];
}
interface BrowserData {
  nodes: CorpusNode[];
  sources: string[];
  base: string;
}

export function initializeCorpusBrowser(): void {
  const root = document.querySelector<HTMLElement>('[data-corpus-browser]');
  if (!root || root.dataset.initialized) return;
  const dataElement = root.querySelector('[data-browser-data]');
  if (!dataElement?.textContent) return;
  const data: BrowserData = JSON.parse(dataElement.textContent);
  const nodes = new Map(data.nodes.map((node) => [node.route, node]));
  const parents = new Map<string, string>();
  for (const node of data.nodes) for (const child of node.children) parents.set(child, node.route);
  const grid = root.querySelector<HTMLElement>('[data-browser-grid]');
  const breadcrumbs = root.querySelector<HTMLElement>('[data-browser-breadcrumbs]');
  const search = root.querySelector<HTMLInputElement>('[data-browser-search]');
  const status = root.querySelector<HTMLElement>('[data-browser-status]');
  const index = root.querySelector<HTMLAnchorElement>('[data-browser-index]');
  if (!grid || !breadcrumbs || !search || !status || !index) return;
  root.dataset.initialized = 'true';
  const trail = (route: string): CorpusNode[] => {
    const result: CorpusNode[] = [];
    let current = nodes.get(route);
    while (current) {
      result.unshift(current);
      current = nodes.get(parents.get(current.route) || '');
    }
    return result;
  };
  const selected = (): string => {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    return params.get('browse') || '';
  };
  const navigate = (route: string): void => {
    search.value = '';
    location.hash = route ? new URLSearchParams({ browse: route }).toString() : 'collection';
    render();
  };
  const render = (): void => {
    const route = selected();
    const node = nodes.get(route);
    const query = search.value.trim().toLocaleLowerCase('en-US');
    const descendants = (route: string): CorpusNode[] => {
      const item = nodes.get(route);
      if (!item) return [];
      return item.type === 'leaf' ? [item] : item.children.flatMap(descendants);
    };
    const visible = query
      ? (node ? descendants(node.route) : data.nodes.filter((item) => item.type === 'leaf')).filter((item) =>
          `${item.title} ${item.description}`.toLocaleLowerCase('en-US').includes(query),
        )
      : (node?.children || data.sources)
          .map((route) => nodes.get(route))
          .filter((item): item is CorpusNode => Boolean(item));
    breadcrumbs.replaceChildren();
    const crumb = (label: string, route: string): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => navigate(route));
      breadcrumbs.append(button);
    };
    crumb('All sources', '');
    for (const parent of node ? trail(node.route) : []) {
      const divider = document.createElement('span');
      divider.textContent = '›';
      divider.setAttribute('aria-hidden', 'true');
      breadcrumbs.append(divider);
      crumb(parent.title, parent.route);
    }
    grid.replaceChildren();
    for (const item of visible) {
      const card = document.createElement('article');
      card.className = 'corpus-card';
      const kind = document.createElement('p');
      kind.className = 'card-kind';
      kind.textContent = item.type === 'leaf' ? 'Document' : data.sources.includes(item.route) ? 'Source' : 'Topic';
      const title = document.createElement('h3');
      const link = document.createElement('a');
      link.href = item.href;
      link.textContent = item.title;
      title.append(link);
      const description = document.createElement('p');
      description.className = 'card-description';
      description.textContent = item.description;
      card.append(kind, title, description);
      if (item.type === 'directory') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'card-action';
        button.textContent = 'Browse topics and documents →';
        button.addEventListener('click', () => navigate(item.route));
        card.append(button);
      } else {
        const open = document.createElement('a');
        open.className = 'card-action';
        open.href = item.href;
        open.textContent = 'Read Markdown →';
        card.append(open);
      }
      grid.append(card);
    }
    status.textContent = query
      ? `${visible.length} ${visible.length === 1 ? 'document matches' : 'documents match'} “${search.value.trim()}”.`
      : `${visible.length} ${node ? 'topics and documents' : 'sources'} to explore.`;
    index.href = node?.href || `${data.base}llms.txt`;
    index.textContent = node ? 'Open this Markdown index →' : 'Open collection index →';
  };
  search.addEventListener('input', render);
  window.addEventListener('hashchange', render);
  render();
}
