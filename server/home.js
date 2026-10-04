import net from 'node:net';

// `tailscale serve` passes the device's tailnet address in X-Forwarded-For.
export const clientIp = (req) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();

// The address the direct connection to that device uses, without the port.
// '' when the device is unknown or only reachable through a relay.
export function directAddr(status, tailscaleIp) {
  const peer = Object.values(status?.Peer ?? {}).find((p) => (p.TailscaleIPs ?? []).includes(tailscaleIp));
  // "192.168.1.23:41641" or "[2001:db8::1]:41641"
  return (peer?.CurAddr ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
}

// True when `addr` lies in one of this machine's own subnets.
export function onLocalSubnet(addr, interfaces) {
  const family = net.isIP(addr);
  if (!family) return false;
  const local = new net.BlockList();
  for (const nic of Object.values(interfaces).flat()) {
    if (!nic || nic.internal || !nic.cidr || nic.address.startsWith('fe80:')) continue;
    const [base, prefix] = nic.cidr.split('/');
    local.addSubnet(base, Number(prefix), nic.family === 'IPv6' ? 'ipv6' : 'ipv4');
  }
  return local.check(addr, family === 6 ? 'ipv6' : 'ipv4');
}

// true: the device talks to this computer over the same local network.
// false: it is somewhere else, or relayed. null: cannot tell (no proxy header, no Tailscale).
export function atHome(status, tailscaleIp, interfaces) {
  if (!status || !tailscaleIp) return null;
  const addr = directAddr(status, tailscaleIp);
  return addr ? onLocalSubnet(addr, interfaces) : false;
}
