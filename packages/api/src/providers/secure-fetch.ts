import { lookup } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';

import { ValidationError } from '../errors';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
// Only globally routed IPv6 unicast is accepted; exclude transition/documentation ranges.
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && /^[23]/.test(address) && !blocked.check(address, 'ipv6');
}

export function validateCustomBaseUrl(raw: string, allowedOrigins: string | undefined): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('Enter a valid HTTPS API URL.');
  }
  const allowed = (allowedOrigins ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !allowed.includes(url.origin)
  ) {
    throw new ValidationError('This API origin is not enabled by the server administrator.');
  }
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')))
    throw new ValidationError('API endpoints must use a public hostname.');
  return url.toString().replace(/\/$/, '');
}

/** Resolve and validate the address at socket creation, preventing DNS rebinding. Never follow redirects. */
export const secureProviderFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  if (url.protocol !== 'https:') throw new Error('Provider endpoints require HTTPS.');
  return new Promise<Response>((resolve, reject) => {
    const req = request(
      url,
      {
        method: init?.method ?? 'POST',
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        signal: init?.signal ?? undefined,
        lookup(hostname, options, callback) {
          lookup(hostname, { ...options, all: true }, (error, addresses) => {
            if (error) return callback(error, '', 4);
            if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
              return callback(new Error('Provider resolved to a non-public address.'), '', 4);
            }
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0]!.address, addresses[0]!.family);
          });
        },
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        resolve(
          new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
            status: res.statusCode ?? 502,
            headers,
          }),
        );
      },
    );
    req.on('error', () => reject(new Error('Could not connect to AI provider.')));
    req.end(typeof init?.body === 'string' ? init.body : undefined);
  });
};
