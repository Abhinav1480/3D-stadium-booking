import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiBaseUrl, apiUrl } from './api.ts';

test('resolveApiBaseUrl strips trailing slashes for production backend URLs', () => {
  assert.equal(
    resolveApiBaseUrl('https://stadiumx-api.onrender.com///', {
      protocol: 'https:',
      hostname: 'stadiumx.vercel.app',
    }),
    'https://stadiumx-api.onrender.com'
  );
});

test('resolveApiBaseUrl falls back to same-origin when env is empty', () => {
  assert.equal(
    resolveApiBaseUrl('', { protocol: 'https:', hostname: 'stadiumx.vercel.app' }),
    ''
  );
  assert.equal(resolveApiBaseUrl(undefined, null), '');
});

test('resolveApiBaseUrl ignores localhost URL when running on non-local HTTPS domain', () => {
  assert.equal(
    resolveApiBaseUrl('http://localhost:3000', {
      protocol: 'https:',
      hostname: 'stadiumx.vercel.app',
    }),
    ''
  );
  assert.equal(
    resolveApiBaseUrl('http://127.0.0.1:3000', {
      protocol: 'https:',
      hostname: 'stadiumx.vercel.app',
    }),
    ''
  );
});

test('resolveApiBaseUrl allows localhost backend during local split-origin testing', () => {
  assert.equal(
    resolveApiBaseUrl('http://127.0.0.1:3008/', {
      protocol: 'http:',
      hostname: '127.0.0.1',
    }),
    'http://127.0.0.1:3008'
  );
});

test('apiUrl normalizes leading slash', () => {
  assert.equal(apiUrl('api/health'), '/api/health');
  assert.equal(apiUrl('/api/matches/1/holds'), '/api/matches/1/holds');
});
