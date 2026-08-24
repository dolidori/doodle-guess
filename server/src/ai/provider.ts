import OpenAI from 'openai';
import { logLifecycle } from '../logging/logger.js';
import { getAiConfig, isAiAvailable, type ProviderConfig } from './config.js';

/** 호출 성공/실패를 세어 둔다. 키가 죽었을 때 로그만 보고도 알 수 있게. */
export type AiStats = {
  provider: string | null;
  model: string | null;
  ok: number;
  fail: number;
  lastAt: number | null;
  lastError: string | null;
};

const stats: AiStats = { provider: null, model: null, ok: 0, fail: 0, lastAt: null, lastError: null };

export const getAiStats = (): AiStats => ({ ...stats });

const noteOk = (provider: string, model: string, task: string, elapsedMs: number): void => {
  stats.provider = provider;
  stats.model = model;
  stats.lastAt = Date.now();
  stats.ok += 1;
  stats.lastError = null;
  // 어느 provider가 실제로 일을 하고 있는지 로그만 보고 알 수 있어야 한다.
  // 무료 쪽이 계속 실패해 유료로만 넘어가고 있어도 눈치채지 못하면 곤란하다.
  logLifecycle('info', 'ai_call', { provider, model, task, elapsedMs, ok: stats.ok });
};

const noteFail = (provider: string, error: unknown, task: string): void => {
  stats.lastAt = Date.now();
  stats.fail += 1;
  const detail = error instanceof Error ? error.message : String(error);
  stats.lastError = `${provider}: ${detail.slice(0, 140)}`;
  const status = (error as { status?: number } | null)?.status ?? 0;
  logLifecycle('info', 'ai_call_failed', {
    provider, task, status, reason: detail.slice(0, 120), fail: stats.fail
  });
};

/**
 * 모델이 JSON만 내놓으라는 지시를 어기고 코드 블록이나 설명을 섞어 보내는 일이
 * 흔하다. 가장 바깥 객체만 떼어 내 파싱한다.
 */
export const parseJsonReply = <T>(raw: string): T | null => {
  const cleaned = raw.replace(/```[a-z]*\n?/gu, '').replace(/```/gu, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/u);
  try {
    return JSON.parse(match ? match[0] : cleaned) as T;
  } catch {
    return null;
  }
};

/**
 * 한도에 걸린 provider를 잠시 건너뛰는 시간. 무료 한도는 하루 단위로 걸리는
 * 곳도 있어, 걸리자마자 다시 두드려 봐야 또 막힌다.
 */
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
/** 한도가 아닌 오류(일시적 장애 등)는 짧게 쉬고 다시 본다. */
const ERROR_COOLDOWN_MS = 30_000;

/** provider 하나를 감싼다. OpenAI 호환 엔드포인트라 셋 다 같은 방식으로 부른다. */
class SingleProvider {
  private readonly client: OpenAI;
  /** 이 시각 전까지는 건너뛴다. */
  private cooldownUntil = 0;

  constructor(readonly config: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.requestTimeoutMs,
      // 체인이 다음 provider로 넘겨 주므로 여기서 매달리지 않는다.
      maxRetries: 0,
      // OpenRouter는 어떤 앱이 부르는지 알려 주면 무료 한도 배분에서 유리하다.
      ...(config.name === 'openrouter'
        ? {
          defaultHeaders: {
            'HTTP-Referer': 'https://doodle-guess.on-boardgames.com',
            'X-Title': 'Doodle Guess'
          }
        }
        : {})
    });
  }

  isCoolingDown(now = Date.now()): boolean {
    return now < this.cooldownUntil;
  }

  private rest(error: unknown, task: string): void {
    const status = (error as { status?: number } | null)?.status;
    // 429(한도)와 402(잔액 부족)는 곧바로 다시 시도해도 소용없다.
    const exhausted = status === 429 || status === 402;
    this.cooldownUntil = Date.now() + (exhausted ? RATE_LIMIT_COOLDOWN_MS : ERROR_COOLDOWN_MS);
    noteFail(this.config.name, error, task);
  }

  async askJson<T>(system: string, user: string, maxTokens: number): Promise<T | null> {
    const startedAt = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.drawModel,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      });
      const parsed = parseJsonReply<T>(response.choices[0]?.message?.content ?? '');
      if (parsed === null) {
        // 잘린 JSON은 이 provider 탓이 아닐 수 있지만, 다음 provider에게 한 번
        // 더 기회를 주는 편이 빈 그림보다 낫다.
        this.rest(new Error('응답을 JSON으로 읽지 못했습니다.'), 'draw');
        return null;
      }
      noteOk(this.config.name, this.config.drawModel, 'draw', Date.now() - startedAt);
      return parsed;
    } catch (error) {
      this.rest(error, 'draw');
      return null;
    }
  }

  async askAboutImage(system: string, instruction: string, png: Buffer): Promise<string | null> {
    const startedAt = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.visionModel,
        max_tokens: 200,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${png.toString('base64')}` }
              }
            ]
          }
        ]
      });
      const text = response.choices[0]?.message?.content?.trim() ?? '';
      if (text.length === 0) {
        this.rest(new Error('빈 응답을 받았습니다.'), 'guess');
        return null;
      }
      noteOk(this.config.name, this.config.visionModel, 'guess', Date.now() - startedAt);
      return text;
    } catch (error) {
      this.rest(error, 'guess');
      return null;
    }
  }
}

/**
 * 설정에 적힌 순서대로 provider를 시도한다. 앞의 것이 한도에 걸리면 뒤로 넘긴다.
 * `AI_PROVIDER=openrouter,gemini`처럼 두면 무료 한도를 먼저 쓰고 모자랄 때만
 * 다음 것으로 넘어간다.
 */
export class AiProvider {
  private readonly chain: SingleProvider[];

  constructor(configs: ProviderConfig[]) {
    this.chain = configs.map((config) => new SingleProvider(config));
  }

  /** 모든 provider가 쉬는 중이면 지금은 부를 곳이 없다. */
  isCoolingDown(now = Date.now()): boolean {
    return this.chain.every((provider) => provider.isCoolingDown(now));
  }

  private async attempt<T>(
    run: (provider: SingleProvider) => Promise<T | null>
  ): Promise<T | null> {
    for (const provider of this.chain) {
      if (provider.isCoolingDown()) continue;
      const result = await run(provider);
      if (result !== null) return result;
    }
    return null;
  }

  askJson<T>(system: string, user: string, maxTokens = 16_000): Promise<T | null> {
    return this.attempt((provider) => provider.askJson<T>(system, user, maxTokens));
  }

  askAboutImage(system: string, instruction: string, png: Buffer): Promise<string | null> {
    return this.attempt((provider) => provider.askAboutImage(system, instruction, png));
  }
}

let singleton: AiProvider | null = null;
let resolved = false;

/** 키가 없으면 null. 호출하는 쪽은 null을 'AI 사용 불가'로 다룬다. */
export const getProvider = (): AiProvider | null => {
  if (resolved) return singleton;
  resolved = true;
  const config = getAiConfig();
  singleton = isAiAvailable(config) ? new AiProvider(config.providers) : null;
  return singleton;
};

/** 지금 어떤 provider도 부를 수 없는 상태인지. */
export const isCoolingDown = (): boolean => getProvider()?.isCoolingDown() ?? true;

/** 테스트에서 환경을 바꿔 가며 확인할 수 있게 해 둔다. */
export const resetProviderForTest = (): void => {
  singleton = null;
  resolved = false;
};
