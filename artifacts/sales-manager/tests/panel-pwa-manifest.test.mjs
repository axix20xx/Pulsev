import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const indexPath = fileURLToPath(new URL('../index.html', import.meta.url));
const html = await readFile(indexPath, 'utf8');
const bootstrap = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];

assert.ok(bootstrap, 'Expected the path-aware PWA bootstrap script in index.html');

function resolvePwaLinks(pathname) {
  const manifestLinks = [];
  const icons = [{ href: '' }];
  const touchIcons = [{ href: '' }];
  const document = {
    createElement: () => ({ rel: '', href: '' }),
    head: {
      appendChild: (element) => manifestLinks.push(element),
    },
    querySelectorAll: (selector) =>
      selector === 'link[rel="icon"]' ? icons : touchIcons,
  };

  new vm.Script(bootstrap).runInNewContext({
    window: { location: { pathname } },
    document,
    navigator: {},
    URL,
  });

  return {
    manifest: manifestLinks[0]?.href,
    icon: icons[0]?.href,
    touchIcon: touchIcons[0]?.href,
  };
}

test('panel PWA links stay under /panel when opened without a trailing slash', () => {
  assert.deepEqual(resolvePwaLinks('/panel'), {
    manifest: '/panel/manifest.webmanifest',
    icon: '/panel/favicon.svg',
    touchIcon: '/panel/apple-touch-icon.png',
  });
});

test('panel subroutes use the same panel PWA manifest and icons', () => {
  assert.deepEqual(resolvePwaLinks('/panel/login'), {
    manifest: '/panel/manifest.webmanifest',
    icon: '/panel/favicon.svg',
    touchIcon: '/panel/apple-touch-icon.png',
  });
});

test('the public root keeps its independent florist branding', () => {
  assert.deepEqual(resolvePwaLinks('/'), {
    manifest: 'manifest.webmanifest',
    icon: '/flower-shop.svg',
    touchIcon: '/flower-shop-icon.png',
  });
});
