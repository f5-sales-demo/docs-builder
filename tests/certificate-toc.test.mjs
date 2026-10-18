import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureCertificateReadingBand,
  restoreCertificateOverview,
  selectCertificateFragment,
} from '../src/lib/certificate-toc.mjs';

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

test('Certificate reading bands include changing breadcrumb height once', () => {
  let height = 64;
  const mobile = { getRootMargin: () => '-136px 0% -811px' };
  const desktop = { getRootMargin: () => '-96px 0% -851px' };
  assert.equal(
    configureCertificateReadingBand('f5-sales-demo/certificate-management', [mobile, desktop], () => height),
    2,
  );
  assert.equal(mobile.getRootMargin(), '-200px 0% -747px');
  assert.equal(desktop.getRootMargin(), '-160px 0% -787px');
  height = 96;
  assert.equal(mobile.getRootMargin(), '-232px 0% -715px');
  assert.equal(
    configureCertificateReadingBand('f5-sales-demo/certificate-management', [mobile], () => height),
    0,
  );
  assert.equal(mobile.getRootMargin(), '-232px 0% -715px');
});

test('Other repositories retain their exact renderer reading band', () => {
  const component = { getRootMargin: () => '-136px 0% -811px' };
  const original = component.getRootMargin;
  assert.equal(
    configureCertificateReadingBand('f5-sales-demo/xcsh', [component], () => 64),
    0,
  );
  assert.equal(component.getRootMargin, original);
});

test('Visible fragments synchronize native state on short pages and reloads', () => {
  const selected = { hash: '#set-api-credentials', textContent: 'Set API credentials' };
  const component = { current: {}, querySelectorAll: () => [selected] };
  selectCertificateFragment('f5-sales-demo/certificate-management', '#set-api-credentials', [component], () => true);
  assert.equal(component.current, selected);
  const previous = component.current;
  selectCertificateFragment('f5-sales-demo/certificate-management', '#elsewhere', [component], () => false);
  selectCertificateFragment('f5-sales-demo/xcsh', '#set-api-credentials', [component], () => true);
  selectCertificateFragment('f5-sales-demo/certificate-management', '#%', [component], () => true);
  assert.equal(component.current, previous);
});
