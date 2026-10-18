/** Keep the section label truthful when returning above the observer's heading band. */
export function restoreCertificateOverview(repository, scrollY, components) {
  if (repository !== 'f5-sales-demo/certificate-management' || scrollY > 1) return;
  for (const component of components) {
    const overview = component.querySelector('a[href="#_top"]');
    // Use Starlight's setter so its tracked state and mobile label stay synchronized.
    if (overview) component.current = overview;
  }
}
