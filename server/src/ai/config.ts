import { AI_GUESS_INTERVAL_MS } from '../../../shared/src/index.js';

/**
 * AI 참여자 설정. 게이트웨이가 `DOODLE_GUESS__` 접두사를 떼고 넘겨주므로
 * 서버는 접두사 없는 이름으로 읽는다.
 *
 * 환경변수
 *   AI_PROVIDER          쓸 provider를 쉼표로 나열한다. 앞에서부터 시도하고 한도에
 *                        걸리거나 실패하면 다음으로 넘어간다.
 *                        예) `openrouter,gemini` — 무료 한도를 먼저 쓰고 모자라면 Gemini.
 *                        (기본: gemini)
 *   AI_PASSWORD          AI를 추가할 수 있는 비밀번호. 없으면 기능 전체가 꺼진다.
 *   AI_GUESS_INTERVAL_MS AI가 캔버스를 다시 보는 간격. 무료 한도가 낮으면 늘린다.
 *   GEMINI_API_KEY       / GEMINI_MODEL       / GEMINI_VISION_MODEL
 *   OPENROUTER_API_KEY   / OPENROUTER_MODEL   / OPENROUTER_VISION_MODEL
 *   DEEPSEEK_API_KEY     / DEEPSEEK_MODEL     / DEEPSEEK_VISION_MODEL
 */
export const AI_PROVIDERS = ['gemini', 'openrouter', 'deepseek'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

type ProviderSpec = {
  baseUrl: string;
  keyEnv: string;
  modelEnv: string;
  visionModelEnv: string;
  defaultModel: string;
  /** 비전과 텍스트를 한 모델로 처리하는 곳은 같은 값을 쓴다. */
  defaultVisionModel: string;
};

const SPECS: Record<AiProviderName, ProviderSpec> = {
  gemini: {
    // Gemini는 OpenAI 호환 엔드포인트를 제공해 같은 클라이언트로 부를 수 있다.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    visionModelEnv: 'GEMINI_VISION_MODEL',
    // 3.5-flash가 조금 더 촘촘하게 그리지만 실측 12배 비싸다. 두들 게스에는
    // 2.5-flash로 충분하다.
    defaultModel: 'gemini-2.5-flash',
    defaultVisionModel: 'gemini-2.5-flash'
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL',
    visionModelEnv: 'OPENROUTER_VISION_MODEL',
    // 개별 무료 모델은 여러 사용자가 나눠 쓰느라 429가 잦다. `openrouter/free`
    // 라우터에 맡기면 그때그때 여유 있는 무료 모델로 알아서 보내 준다.
    defaultModel: 'openrouter/free',
    defaultVisionModel: 'openrouter/free'
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    modelEnv: 'DEEPSEEK_MODEL',
    visionModelEnv: 'DEEPSEEK_VISION_MODEL',
    defaultModel: 'deepseek-v4-flash',
    // DeepSeek만 비전이 별도 모델이다.
    defaultVisionModel: 'deepseek-v4-flash-vision-exp'
  }
};

export type ProviderConfig = {
  name: AiProviderName;
  apiKey: string;
  baseUrl: string;
  /** 그림을 그릴 때 쓰는 모델. */
  drawModel: string;
  /** 그림을 알아볼 때 쓰는 모델. */
  visionModel: string;
  requestTimeoutMs: number;
};

export type AiConfig = {
  /** 앞에서부터 시도한다. 키가 없는 provider는 아예 담기지 않는다. */
  providers: ProviderConfig[];
  /** 비밀번호가 비어 있으면 아무도 AI를 추가할 수 없다. */
  password: string;
  /**
   * AI 추측자가 캔버스를 다시 보기까지 기다리는 간격. 무료 한도가 낮은 곳에서는
   * 늘려 잡아야 한도에 걸리지 않는다. AI n명이면 분당 대략 (60 / 간격초) * n 회다.
   */
  guessIntervalMs: number;
};

/** 쉼표로 나열된 이름을 적힌 순서 그대로 읽는다. 모르는 이름과 중복은 버린다. */
const resolveProviderNames = (raw: string | undefined): AiProviderName[] => {
  const names = (raw ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is AiProviderName => AI_PROVIDERS.includes(part as AiProviderName));
  const unique = [...new Set(names)];
  return unique.length > 0 ? unique : ['gemini'];
};

export const loadAiConfig = (env: NodeJS.ProcessEnv = process.env): AiConfig => {
  /**
   * 라운드는 보통 60초다. 무료 모델은 그림 계획처럼 긴 답을 쓸 때 1분 가까이
   * 걸리는 일이 있어, 그 답을 끝까지 기다리면 정작 그릴 시간이 사라진다.
   * 여기서 끊어 주면 체인이 다음 provider로 넘겨 제때 그림이 나온다.
   * 짧은 답(추측)은 무료 모델도 2초 안에 오므로 이 값에 걸리지 않는다.
   */
  const requestTimeoutMs = Number(env.AI_TIMEOUT_MS ?? 20_000);
  const providers = resolveProviderNames(env.AI_PROVIDER)
    .map((name) => {
      const spec = SPECS[name];
      return {
        name,
        apiKey: env[spec.keyEnv]?.trim() ?? '',
        baseUrl: env[`${name.toUpperCase()}_BASE_URL`]?.trim() || spec.baseUrl,
        drawModel: env[spec.modelEnv]?.trim() || spec.defaultModel,
        visionModel: env[spec.visionModelEnv]?.trim() || spec.defaultVisionModel,
        requestTimeoutMs
      };
    })
    // 키가 없는 provider를 남겨 두면 매번 헛되이 부르고 실패만 한다.
    .filter((provider) => provider.apiKey.length > 0);

  return {
    providers,
    password: env.AI_PASSWORD?.trim() ?? '',
    guessIntervalMs: Math.max(3000, Number(env.AI_GUESS_INTERVAL_MS ?? AI_GUESS_INTERVAL_MS))
  };
};

/**
 * 쓸 수 있는 provider가 하나도 없거나 비밀번호가 없으면 AI를 켤 수 없다.
 * 키만 있고 비밀번호가 없으면 아무나 쓰게 되므로 둘 다 본다.
 */
export const isAiAvailable = (config: AiConfig): boolean =>
  config.providers.length > 0 && config.password.length > 0;

let cached: AiConfig | null = null;

/**
 * 권한 계산과 상태 발행은 획 하나마다 참여자 수만큼 돌아가는 자리다. 거기서
 * 매번 환경변수를 새로 읽으면 그리기가 느려진다. 환경변수는 프로세스가 사는
 * 동안 바뀌지 않으므로 한 번만 읽어 둔다.
 */
export const getAiConfig = (): AiConfig => (cached ??= loadAiConfig());

/** 테스트에서 환경을 바꿔 가며 확인할 수 있게 해 둔다. */
export const resetAiConfigForTest = (): void => {
  cached = null;
};
