export type ServerConfig = {
  port: number;
  host: string;
  nodeEnv: string;
  /** 프록시(Render 등) 뒤에서 실행될 때 X-Forwarded-For로 실제 접속자 IP를 읽는다. */
  trustProxy: boolean;
  allowedOrigins: Set<string>;
};

export const loadConfig = (): ServerConfig => ({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  trustProxy: process.env.TRUST_PROXY
    ? process.env.TRUST_PROXY === '1'
    : (process.env.NODE_ENV ?? 'development') === 'production',
  allowedOrigins: new Set(
    (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  )
});
