export const websocketUrl = (): string => {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws`;
};

export const openWebSocket = (): WebSocket => new WebSocket(websocketUrl());
