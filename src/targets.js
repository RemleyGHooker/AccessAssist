// Which target systems the tester may call (Phase 5, closes LIM-07) and whether a target is
// Team 19's own system (for coverage.model and the Team 19 design checks).
//
// The tester sends files and requests to whatever target_url it is given, so without a check it
// could be pointed at internal addresses (Cloud Run metadata server, localhost, private
// networks). A target must be an http(s) base URL with no credentials, query or fragment, and
// every address its host name resolves to must be public. ALLOW_PRIVATE_TARGETS=true lifts the
// address rule for local development and CI, where the target is 127.0.0.1. Optionally,
// ALLOWED_TARGET_HOSTS (comma-separated host names) limits targets to the registered pod hosts.

import { lookup } from 'node:dns/promises';
import net from 'node:net';

// The deployed Team 19 system. OWN_SYSTEM_URLS (comma-separated) adds other addresses of it.
export const LIVE_SYSTEM_URL = 'https://accessassist-git-365255122806.europe-west1.run.app/system';

const blocked = new net.BlockList();
for (const [net4, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(net4, prefix, 'ipv4');
for (const [net6, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]]) {
  blocked.addSubnet(net6, prefix, 'ipv6');
}

export function isPrivateAddress(address) {
  const type = net.isIP(address);
  if (type === 0) return true; // not an address at all: refuse rather than guess
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is written as IPv6 but routes to the IPv4 address.
  const mapped = type === 6 && /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  return blocked.check(address, type === 4 ? 'ipv4' : 'ipv6');
}

// Returns null when the target may be used, or { status, message, source } to send back.
export async function checkTarget(raw, { resolve = lookup } = {}) {
  let url;
  try { url = new URL(raw); } catch { url = null; }
  if (typeof raw !== 'string' || !url || !['http:', 'https:'].includes(url.protocol) || /\s/.test(raw)) {
    return { status: 400, message: 'target_url must be an http(s) base URL.', source: 'tester' };
  }
  if (url.username || url.password) {
    return { status: 400, message: 'target_url must not contain credentials.', source: 'tester' };
  }
  if (url.search || url.hash || raw.includes('?') || raw.includes('#')) {
    return { status: 400, message: 'target_url must have no query or fragment.', source: 'tester' };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const allowed = (process.env.ALLOWED_TARGET_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(host)) {
    return { status: 400, message: `target_url host is not a registered pod system (${allowed.join(', ')}).`, source: 'tester' };
  }
  if (process.env.ALLOW_PRIVATE_TARGETS === 'true') return null;

  let addresses;
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await resolve(host, { all: true })).map((a) => a.address);
    } catch (e) {
      return { status: 500, message: `Could not resolve the target host ${host}: ${e.code ?? e.message}`, source: 'communication' };
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    return { status: 400, message: 'target_url must point to a public pod system, not a private, loopback or internal address.', source: 'tester' };
  }
  return null;
}

function normalize(base) {
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

// True when target_url is this deployment's own /system (same public origin as the request that
// reached the tester) or one of the known addresses of the Team 19 system.
export function isOwnSystem(targetUrl, req) {
  const target = normalize(targetUrl);
  if (!target) return false;
  const own = [LIVE_SYSTEM_URL, ...(process.env.OWN_SYSTEM_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean)];
  if (req) own.push(`${req.protocol}://${req.get('host')}/system`);
  return own.map(normalize).includes(target);
}
