import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, directAddr, onLocalSubnet, atHome } from '../server/home.js';

const interfaces = {
  'Wi-Fi': [
    { address: '192.168.1.5', family: 'IPv4', internal: false, cidr: '192.168.1.5/24' },
    { address: '2001:db8:1:2::5', family: 'IPv6', internal: false, cidr: '2001:db8:1:2::5/64' },
    { address: 'fe80::1', family: 'IPv6', internal: false, cidr: 'fe80::1/64' },
  ],
  Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true, cidr: '127.0.0.1/8' }],
};
const status = {
  Peer: {
    k1: { TailscaleIPs: ['100.64.0.2', 'fd7a::2'], CurAddr: '192.168.1.23:41641' },
    k2: { TailscaleIPs: ['100.64.0.3'], CurAddr: '[2001:db8:9:9::7]:41641' },
    k3: { TailscaleIPs: ['100.64.0.4'], CurAddr: '' },
    k4: { TailscaleIPs: ['100.64.0.5'], CurAddr: '[2001:db8:1:2::77]:5000' },
  },
};

test('clientIp reads the first forwarded address', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '100.64.0.2, 127.0.0.1' } }), '100.64.0.2');
  assert.equal(clientIp({ headers: {} }), '');
});

test('directAddr strips the port from IPv4 and bracketed IPv6 endpoints', () => {
  assert.equal(directAddr(status, '100.64.0.2'), '192.168.1.23');
  assert.equal(directAddr(status, 'fd7a::2'), '192.168.1.23');
  assert.equal(directAddr(status, '100.64.0.3'), '2001:db8:9:9::7');
  assert.equal(directAddr(status, '100.64.0.4'), '');
  assert.equal(directAddr(status, '100.64.0.99'), '');
});

test('onLocalSubnet matches only the networks this machine is on', () => {
  assert.equal(onLocalSubnet('192.168.1.23', interfaces), true);
  assert.equal(onLocalSubnet('192.168.2.23', interfaces), false);
  assert.equal(onLocalSubnet('2001:db8:1:2::77', interfaces), true);
  assert.equal(onLocalSubnet('127.0.0.9', interfaces), false);
  assert.equal(onLocalSubnet('fe80::9', interfaces), false);
  assert.equal(onLocalSubnet('not-an-address', interfaces), false);
});

test('atHome: a local direct link is home, elsewhere or relayed is not, missing data is unknown', () => {
  assert.equal(atHome(status, '100.64.0.2', interfaces), true);
  assert.equal(atHome(status, '100.64.0.5', interfaces), true);
  assert.equal(atHome(status, '100.64.0.3', interfaces), false);
  assert.equal(atHome(status, '100.64.0.4', interfaces), false);
  assert.equal(atHome(status, '', interfaces), null);
  assert.equal(atHome(null, '100.64.0.2', interfaces), null);
});
