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
