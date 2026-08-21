import type { IncomingMessage } from 'node:http';

/**
 * 프록시 뒤에서는 socket.remoteAddress가 프록시 IP라 접속자 전원이 한 IP로 묶인다.
 * 신뢰하는 프록시 뒤에서만 X-Forwarded-For의 첫 항목(원 접속자)을 사용한다.
 *
 * 이 값은 레이트리밋의 보조 버킷 키로만 쓰인다. 헤더를 위조해도 연결별 주 버킷은
 * 피할 수 없으므로, 위조로 얻을 수 있는 이득이 없다.
 */
export const clientIp = (request: IncomingMessage, trustProxy: boolean): string => {
  if (trustProxy) {
    const header = request.headers['x-forwarded-for'];
    const raw = Array.isArray(header) ? header[0] : header;
    const first = raw?.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.socket.remoteAddress ?? 'unknown';
};
