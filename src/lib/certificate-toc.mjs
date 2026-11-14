/** Keep the section label truthful when returning above the observer's heading band. */
export function restoreCertificateOverview(repository, scrollY, components) {
  if (repository !== 'f5-sales-demo/certificate-management' || scrollY > 1) return;
  for (const component of components) {
    const overview = component.querySelector('a[href="#_top"]');
    // Use Starlight's setter so its tracked state and mobile label stay synchronized.
    if (overview) component.current = overview;
  }
}

const configuredComponents = new WeakSet();

/** Keep Starlight native intersections below the additional Certificate breadcrumb row. */
export function configureCertificateReadingBand(repository, components, getBreadcrumbHeight) {
  if (repository !== 'f5-sales-demo/certificate-management') return 0;
  let configured = 0;
  for (const component of components) {
    if (configuredComponents.has(component) || typeof component.getRootMargin !== 'function') continue;
    const original = component.getRootMargin.bind(component);
    component.getRootMargin = () => {
      const [top, horizontal, bottom] = original().split(' ');
      const height = getBreadcrumbHeight();
      return `${parseFloat(top) - height}px ${horizontal} ${parseFloat(bottom) + height}px`;
    };
    configuredComponents.add(component);
    configured++;
  }
  return configured;
}

/** A visible bookmarked heading is selected even when a short page cannot scroll further. */
export function selectCertificateFragment(repository, hash, components, isVisible) {
  if (repository !== 'f5-sales-demo/certificate-management' || !hash) return;
  let id;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return;
  }
  if (!isVisible(id)) return;
  for (const component of components) {
    const link = [...component.querySelectorAll('a[href]')].find((item) => item.hash === `#${encodeURIComponent(id)}`);
    if (link) component.current = link;
  }
}

/** Select a bookmarked heading after font loading and native layout updates settle. */
export async function selectCertificateFragmentAfterLayout(repository, hash, components, isVisible, waitForLayout) {
  await waitForLayout();
  selectCertificateFragment(repository, hash, components, isVisible);
}

const configuredFragmentSelection = new WeakSet();

function unreachableFragment(component, snapshot) {
  if (!snapshot?.hash) return;
  const { top, bottom, height, scrollY, maxScroll, readingTop } = snapshot;
  if (![top, bottom, height, scrollY, maxScroll, readingTop].every(Number.isFinite)) return;
  if (bottom <= 0 || top >= height || top + scrollY - maxScroll <= readingTop) return;
  let id;
  try {
    id = decodeURIComponent(snapshot.hash.slice(1));
  } catch {
    return;
  }
  return [...component.querySelectorAll('a[href]')].find((link) => link.hash === `#${encodeURIComponent(id)}`);
}

/** Preserve visible bookmarks that cannot reach the native band on short pages. */
export function configureCertificateFragmentSelection(repository, components, getFragment) {
  if (repository !== 'f5-sales-demo/certificate-management') return 0;
  let configured = 0;
  for (const component of components) {
    if (configuredFragmentSelection.has(component)) continue;
    let owner = component;
    let descriptor;
    while (owner) {
      descriptor = Object.getOwnPropertyDescriptor(owner, 'current');
      if (descriptor?.set) break;
      owner = Object.getPrototypeOf(owner);
    }
    if (!descriptor?.set) continue;
    const native = descriptor.set;
    Object.defineProperty(component, 'current', {
      configurable: true,
      get: descriptor.get,
      set(link) {
        native.call(this, unreachableFragment(this, getFragment(this)) || link);
      },
    });
    configuredFragmentSelection.add(component);
    configured++;
  }
  return configured;
}
