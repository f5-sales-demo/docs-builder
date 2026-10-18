import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreCertificateOverview } from '../src/lib/certificate-toc.mjs';

test('returning above the first content section resets desktop and mobile section state', () => {
  const overview = { textContent: 'Overview' };
  const components = [
    { current: { textContent: 'Complete HCL' }, querySelector: () => overview },
    { current: { textContent: 'Qualification HCL' }, querySelector: () => overview },
  ];
  restoreCertificateOverview('f5-sales-demo/certificate-management', 0, components);
  assert.equal(components[0].current, overview);
  assert.equal(components[1].current, overview);
});

test('normal scroll and other repositories retain the renderer section state', () => {
  const previous = { textContent: 'Verify' };
  const component = { current: previous, querySelector: () => ({ textContent: 'Overview' }) };
  restoreCertificateOverview('f5-sales-demo/certificate-management', 200, [component]);
  restoreCertificateOverview('f5-sales-demo/xcsh', 0, [component]);
  assert.equal(component.current, previous);
});
