import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureCertificateFragmentSelection,
  configureCertificateReadingBand,
  createCertificateBookmarkTracker,
  restoreCertificateOverview,
  restoreCertificateReadingPosition,
  selectCertificateFragment,
  selectCertificateFragmentAfterLayout,
} from '../src/lib/certificate-toc.mjs';

test('returning above the first content section resets desktop and mobile section state', () => {
  const overview = { textContent: 'Overview' };
  const components = [
    { current: { textContent: 'Complete HCL' }, querySelector: () => overview },
    {
      current: { textContent: 'Qualification HCL' },
      querySelector: () => overview,
    },
  ];
  restoreCertificateOverview('f5-sales-demo/certificate-management', 0, components);
  assert.equal(components[0].current, overview);
  assert.equal(components[1].current, overview);
});

test('normal scroll and other repositories retain the renderer section state', () => {
  const previous = { textContent: 'Verify' };
  const component = {
    current: previous,
    querySelector: () => ({ textContent: 'Overview' }),
  };
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
  const selected = {
    hash: '#set-api-credentials',
    textContent: 'Set API credentials',
  };
  const component = { current: {}, querySelectorAll: () => [selected] };
  selectCertificateFragment('f5-sales-demo/certificate-management', '#set-api-credentials', [component], () => true);
  assert.equal(component.current, selected);
  const previous = component.current;
  selectCertificateFragment('f5-sales-demo/certificate-management', '#elsewhere', [component], () => false);
  selectCertificateFragment('f5-sales-demo/xcsh', '#set-api-credentials', [component], () => true);
  selectCertificateFragment('f5-sales-demo/certificate-management', '#%', [component], () => true);
  assert.equal(component.current, previous);
});

test('bookmarked sections wait for font/layout readiness before selecting native state', async () => {
  let ready;
  let visible = false;
  const layout = new Promise((resolve) => {
    ready = resolve;
  });
  const selected = {
    hash: '#interception-signing-ca',
    textContent: 'Interception signing CA',
  };
  const initial = { textContent: 'Overview' };
  const component = { current: initial, querySelectorAll: () => [selected] };
  const pending = selectCertificateFragmentAfterLayout(
    'f5-sales-demo/certificate-management',
    '#interception-signing-ca',
    [component],
    () => visible,
    () => layout,
  );
  assert.equal(component.current, initial);
  visible = true;
  ready();
  await pending;
  assert.equal(component.current, selected);
});

class NativeToc {
  constructor(links) {
    this.links = links;
    this.selected = links[0];
  }
  get current() {
    return this.selected;
  }
  set current(link) {
    this.selected = link;
  }
  querySelectorAll() {
    return this.links;
  }
}

test('a visible short-page bookmark survives later native reading-band updates', () => {
  const overview = { hash: '#_top' };
  const workflow = { hash: '#workflow' };
  const component = new NativeToc([overview, workflow]);
  const geometry = {
    hash: '#workflow',
    top: 558,
    bottom: 595,
    height: 1000,
    scrollY: 0,
    maxScroll: 149,
    readingTop: 160,
  };
  assert.equal(
    configureCertificateFragmentSelection('f5-sales-demo/certificate-management', [component], () => geometry),
    1,
  );
  component.current = overview;
  assert.equal(component.current, workflow);
});

test('normal native tracking resumes when the heading can reach the band or leaves view', () => {
  const overview = { hash: '#_top' };
  const workflow = { hash: '#workflow' };
  const component = new NativeToc([overview, workflow]);
  const geometry = {
    hash: '#workflow',
    top: 558,
    bottom: 595,
    height: 1000,
    scrollY: 0,
    maxScroll: 1000,
    readingTop: 160,
    readerScrolled: true,
  };
  configureCertificateFragmentSelection('f5-sales-demo/certificate-management', [component], () => geometry);
  component.current = overview;
  assert.equal(component.current, overview);
  geometry.maxScroll = 149;
  geometry.top = 1100;
  geometry.bottom = 1137;
  component.current = overview;
  assert.equal(component.current, overview);
  geometry.top = 558;
  geometry.bottom = 595;
  geometry.hash = '#%';
  component.current = overview;
  assert.equal(component.current, overview);
});

test('fragment guards retain native setters, install once, and do not affect other repositories', () => {
  const overview = { hash: '#_top' };
  const workflow = { hash: '#workflow' };
  class MobileToc extends NativeToc {
    set current(link) {
      super.current = link;
      this.label = link.hash;
    }
  }
  const component = new MobileToc([overview, workflow]);
  const geometry = {
    hash: '#workflow',
    top: 558,
    bottom: 595,
    height: 1000,
    scrollY: 0,
    maxScroll: 149,
    readingTop: 160,
  };
  assert.equal(
    configureCertificateFragmentSelection('f5-sales-demo/xcsh', [component], () => geometry),
    0,
  );
  assert.equal(Object.hasOwn(component, 'current'), false);
  assert.equal(
    configureCertificateFragmentSelection('f5-sales-demo/certificate-management', [component], () => geometry),
    1,
  );
  const installed = Object.getOwnPropertyDescriptor(component, 'current').set;
  assert.equal(
    configureCertificateFragmentSelection('f5-sales-demo/certificate-management', [component], () => geometry),
    0,
  );
  assert.equal(Object.getOwnPropertyDescriptor(component, 'current').set, installed);
  component.current = overview;
  assert.equal(component.selected, workflow);
  assert.equal(component.label, '#workflow');
});

test('explicit long-page bookmarks survive delayed native updates until the reader scrolls', () => {
  const overview = { hash: '#_top' };
  const recover = { hash: '#recover-interrupted-changes' };
  const component = new NativeToc([overview, recover]);
  const geometry = {
    hash: recover.hash,
    top: 245,
    bottom: 282,
    height: 1000,
    scrollY: 1200,
    maxScroll: 2000,
    readingTop: 160,
  };
  configureCertificateFragmentSelection('f5-sales-demo/certificate-management', [component], () => geometry);
  component.current = recover;
  component.current = overview;
  assert.equal(component.current, recover);
  geometry.scrollY += 100;
  geometry.readerScrolled = true;
  component.current = overview;
  assert.equal(component.current, overview);
  geometry.readerScrolled = false;
  component.current = recover;
  geometry.top = -100;
  geometry.bottom = -63;
  component.current = overview;
  assert.equal(component.current, overview);
});

test('manual scrolling releases short-page bookmark preference without changing the hash', () => {
  const overview = { hash: '#_top' };
  const workflow = { hash: '#workflow' };
  const component = new NativeToc([overview, workflow]);
  const geometry = {
    hash: workflow.hash,
    top: 558,
    bottom: 595,
    height: 1000,
    scrollY: 0,
    maxScroll: 149,
    readingTop: 160,
  };
  configureCertificateFragmentSelection('f5-sales-demo/certificate-management', [component], () => geometry);
  component.current = workflow;
  geometry.scrollY = 100;
  geometry.readerScrolled = true;
  component.current = overview;
  assert.equal(component.current, overview);
});

test('layout scrolls retain bookmark intent while reader scroll gestures release it', () => {
  const tracker = createCertificateBookmarkTracker();
  tracker.observeScroll();
  assert.equal(tracker.hasReaderScrolled(), false);
  tracker.prepareScroll();
  tracker.observeScroll();
  assert.equal(tracker.hasReaderScrolled(), true);
  tracker.beginNavigation();
  assert.equal(tracker.hasReaderScrolled(), false);
  tracker.prepareScroll();
  tracker.clearIntent();
  tracker.observeScroll();
  assert.equal(tracker.hasReaderScrolled(), false);
});

test('only the first reader scroll requests native observer refresh', () => {
  const tracker = createCertificateBookmarkTracker();
  assert.equal(tracker.observeScroll(), false);
  tracker.prepareScroll();
  assert.equal(tracker.observeScroll(), true);
  assert.equal(tracker.observeScroll(), false);
  tracker.beginNavigation();
  tracker.prepareScroll();
  assert.equal(tracker.observeScroll(), true);
});

test('resuming scroll selects the nearest heading before the native reading band', () => {
  const overview = { hash: '#_top' };
  const setup = { hash: '#setup' };
  const recover = { hash: '#recover' };
  const component = new NativeToc([overview, setup, recover]);
  component.getRootMargin = () => '-160px 0% -787px';
  const bounds = {
    _top: { top: -900, height: 40 },
    setup: { top: -100, height: 37 },
    recover: { top: 700, height: 37 },
  };
  component.current = recover;
  restoreCertificateReadingPosition('f5-sales-demo/certificate-management', [component], (id) => bounds[id]);
  assert.equal(component.current, setup);
  bounds.setup.top = 300;
  restoreCertificateReadingPosition('f5-sales-demo/certificate-management', [component], (id) => bounds[id]);
  assert.equal(component.current, overview);
  component.current = recover;
  restoreCertificateReadingPosition('f5-sales-demo/xcsh', [component], (id) => bounds[id]);
  assert.equal(component.current, recover);
});
