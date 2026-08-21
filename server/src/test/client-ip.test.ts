import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { clientIp } from '../websocket/clientIp.js';

const request = (
  headers: Record<string, string | string[]>,
  remoteAddress = '10.0.0.1'
): IncomingMessage =>
  ({ headers, socket: { remoteAddress } } as unknown as IncomingMessage);

describe('프록시 뒤 접속자 IP 판별', () => {
  it('프록시를 신뢰하면 X-Forwarded-For의 원 접속자를 쓴다', () => {
    const forwarded = request({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' });
    expect(clientIp(forwarded, true)).toBe('203.0.113.7');
  });

  it('프록시 뒤 서로 다른 접속자는 서로 다른 IP로 구분된다', () => {
    const first = clientIp(request({ 'x-forwarded-for': '203.0.113.7' }), true);
    const second = clientIp(request({ 'x-forwarded-for': '203.0.113.8' }), true);
    expect(first).not.toBe(second);
  });

  it('프록시를 신뢰하지 않으면 헤더를 무시한다', () => {
    const spoofed = request({ 'x-forwarded-for': '1.2.3.4' }, '10.0.0.1');
    expect(clientIp(spoofed, false)).toBe('10.0.0.1');
  });

  it('헤더가 없으면 소켓 주소로 되돌아간다', () => {
    expect(clientIp(request({}), true)).toBe('10.0.0.1');
  });
});
