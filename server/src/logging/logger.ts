export const logLifecycle = (
  level: 'info' | 'error',
  event: string,
  details: Record<string, string | number | boolean> = {}
): void => {
  const entry = JSON.stringify({ level, event, ...details, at: Date.now() });
  if (level === 'error') console.error(entry);
  else console.info(entry);
};
