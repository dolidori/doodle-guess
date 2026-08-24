import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * provider 폴백만 따로 본다. OpenAI 클라이언트를 가짜로 바꿔, 어느 주소로
 * 몇 번 불렸는지와 한도에 걸렸을 때 다음으로 넘어가는지를 확인한다.
 */
const create = vi.fn();
const seen: Array<{ baseURL: string; model: string }> = [];

vi.mock('openai', () => ({
  default: class {
    baseURL: string;
    chat: { completions: { create: (params: { model: string }) => Promise<unknown> } };
    constructor(options: { baseURL: string }) {
      this.baseURL = options.baseURL;
      this.chat = {
        completions: {
          create: (params: { model: string }) => {
            seen.push({ baseURL: this.baseURL, model: params.model });
            return create(this.baseURL, params);
          }
        }
      };
    }
  }
}));

const { AiProvider } = await import('../ai/provider.js');
type ProviderConfig = import('../ai/config.js').ProviderConfig;

const config = (
  name: ProviderConfig['name'],
  baseUrl: string
): ProviderConfig => ({
  name,
  apiKey: `${name}-key`,
  baseUrl,
  drawModel: `${name}-draw`,
  visionModel: `${name}-vision`,
  requestTimeoutMs: 1000
});

const OPENROUTER = config('openrouter', 'https://openrouter.test/');
const GEMINI = config('gemini', 'https://gemini.test/');

const reply = (text: string) => ({ choices: [{ message: { content: text } }] });
const httpError = (status: number): Error & { status: number } =>
  Object.assign(new Error(`HTTP ${status}`), { status });

describe('provider 폴백', () => {
  beforeEach(() => {
    create.mockReset();
    seen.length = 0;
  });

  it('앞에 적은 provider를 먼저 쓴다', async () => {
    create.mockResolvedValue(reply('{"ok":true}'));
    const provider = new AiProvider([OPENROUTER, GEMINI]);

    await provider.askJson('sys', 'user');

    expect(seen).toHaveLength(1);
    expect(seen[0]!.baseURL).toBe('https://openrouter.test/');
  });

  it('앞의 provider가 한도에 걸리면 다음으로 넘어간다', async () => {
    create.mockImplementation((baseURL: string) =>
      baseURL.includes('openrouter')
        ? Promise.reject(httpError(429))
        : Promise.resolve(reply('{"guess":"사과"}')));
    const provider = new AiProvider([OPENROUTER, GEMINI]);

    const result = await provider.askJson<{ guess: string }>('sys', 'user');

    expect(result).toEqual({ guess: '사과' });
    expect(seen.map((call) => call.baseURL)).toEqual([
      'https://openrouter.test/',
      'https://gemini.test/'
    ]);
  });

  it('한 번 한도에 걸린 provider는 한동안 건너뛴다', async () => {
    create.mockImplementation((baseURL: string) =>
      baseURL.includes('openrouter')
        ? Promise.reject(httpError(429))
        : Promise.resolve(reply('{"ok":true}')));
    const provider = new AiProvider([OPENROUTER, GEMINI]);

    await provider.askJson('sys', 'user');
    seen.length = 0;
    await provider.askJson('sys', 'user');

    // 두 번째 호출은 지친 OpenRouter를 건너뛰고 바로 Gemini로 간다.
    expect(seen.map((call) => call.baseURL)).toEqual(['https://gemini.test/']);
  });

  it('잔액이 떨어진 provider도 같은 방식으로 건너뛴다', async () => {
    create.mockImplementation((baseURL: string) =>
      baseURL.includes('openrouter')
        ? Promise.reject(httpError(402))
        : Promise.resolve(reply('{"ok":true}')));
    const provider = new AiProvider([OPENROUTER, GEMINI]);

    await provider.askJson('sys', 'user');
    seen.length = 0;
    await provider.askJson('sys', 'user');

    expect(seen.map((call) => call.baseURL)).toEqual(['https://gemini.test/']);
  });

  it('그림을 볼 때도 같은 순서로 넘어간다', async () => {
    create.mockImplementation((baseURL: string) =>
      baseURL.includes('openrouter')
        ? Promise.reject(httpError(429))
        : Promise.resolve(reply('{"guess":"고양이"}')));
    const provider = new AiProvider([OPENROUTER, GEMINI]);

    const result = await provider.askAboutImage('sys', 'what?', Buffer.from('png'));

    expect(result).toBe('{"guess":"고양이"}');
    // 그림은 비전 모델로 부른다.
    expect(seen.map((call) => call.model)).toEqual(['openrouter-vision', 'gemini-vision']);
  });

  it('모두 실패하면 null을 주고 라운드를 막지 않는다', async () => {
    create.mockRejectedValue(httpError(429));
    const provider = new AiProvider([OPENROUTER, GEMINI]);

    expect(await provider.askJson('sys', 'user')).toBeNull();
    expect(provider.isCoolingDown()).toBe(true);
  });

  it('한 곳이라도 성한 곳이 있으면 쉬는 중이 아니다', async () => {
    create.mockImplementation((baseURL: string) =>
      baseURL.includes('openrouter')
        ? Promise.reject(httpError(429))
        : Promise.resolve(reply('{"ok":true}')));
    const provider = new AiProvider([OPENROUTER, GEMINI]);

    await provider.askJson('sys', 'user');

    expect(provider.isCoolingDown()).toBe(false);
  });

  it('JSON을 못 읽으면 다음 provider에게 한 번 더 맡긴다', async () => {
    create.mockImplementation((baseURL: string) =>
      baseURL.includes('openrouter')
        ? Promise.resolve(reply('음... 잘 모르겠네요'))
        : Promise.resolve(reply('{"guess":"나무"}')));
    const provider = new AiProvider([OPENROUTER, GEMINI]);

    expect(await provider.askJson<{ guess: string }>('sys', 'user')).toEqual({ guess: '나무' });
  });

  it('provider가 하나뿐이면 그 하나만 쓴다', async () => {
    create.mockResolvedValue(reply('{"ok":true}'));
    const provider = new AiProvider([GEMINI]);

    await provider.askJson('sys', 'user');

    expect(seen.map((call) => call.baseURL)).toEqual(['https://gemini.test/']);
  });
});
