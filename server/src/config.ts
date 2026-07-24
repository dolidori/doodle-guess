export type ServerConfig = {
  port: number;
  host: string;
  nodeEnv: string;
  allowedOrigins: Set<string>;
};

export const loadConfig = (): ServerConfig => ({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  allowedOrigins: new Set(
    (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  )
});
