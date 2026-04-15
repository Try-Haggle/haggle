import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callLLM } from '../negotiation/adapters/xai-client.js';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

beforeEach(() => {
  vi.stubEnv('XAI_API_KEY', 'test-key-123');
  vi.stubEnv('XAI_MODEL', 'grok-4-fast');
  vi.stubEnv('LLM_TELEMETRY', '0');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('callLLM', () => {
  it('returns parsed response on success', async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: '{"action":"COUNTER","price":45000,"reasoning":"test"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const result = await callLLM('system prompt', 'user prompt');

    expect(result.content).toBe('{"action":"COUNTER","price":45000,"reasoning":"test"}');
    expect(result.usage.prompt_tokens).toBe(100);
    expect(result.usage.completion_tokens).toBe(50);
    expect(result.reasoning_used).toBe(false);
  });

  it('uses reasoning mode when flag is set', async () => {
    // Use a non-fast model so reasoning_effort is included
    vi.stubEnv('XAI_MODEL', 'grok-4');

    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: '{"action":"ACCEPT","reasoning":"reasoning mode"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 200, completion_tokens: 100 },
    });

    const result = await callLLM('system', 'user', { reasoning: true });

    expect(result.reasoning_used).toBe(true);

    // Verify the request body includes reasoning_effort
    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.reasoning_effort).toBe('high');
    expect(body.temperature).toBe(0.3); // reasoning temp
  });

  it('uses general mode by default', async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: '{"action":"COUNTER","reasoning":"general"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    await callLLM('system', 'user');

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.temperature).toBe(0.5); // general temp
  });

  it('sends correct headers', async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
      usage: {},
    });

    await callLLM('system', 'user');

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].headers['Authorization']).toBe('Bearer test-key-123');
    expect(callArgs[1].headers['Content-Type']).toBe('application/json');
  });

  it('uses structured output (json_object)', async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
      usage: {},
    });

    await callLLM('system', 'user');

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('retries on 500 error then succeeds', async () => {
    const errorResponse = {
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    } as unknown as Response;

    const successResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"action":"COUNTER","reasoning":"retry success"}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as unknown as Response;

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(successResponse);

    const result = await callLLM('system', 'user');
    expect(result.content).toContain('retry success');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('throws on 400 error without retrying', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad Request'),
    } as unknown as Response);

    await expect(callLLM('system', 'user')).rejects.toThrow('xAI API error 400');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('throws when XAI_API_KEY is missing', async () => {
    vi.stubEnv('XAI_API_KEY', '');
    // The error happens when getApiKey() is called inside callLLM
    // We need to delete the env var entirely
    delete process.env.XAI_API_KEY;

    globalThis.fetch = mockFetchResponse({});

    await expect(callLLM('system', 'user')).rejects.toThrow('XAI_API_KEY not configured');
  });

  it('returns empty content when choices array is empty', async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 0 },
    });

    const result = await callLLM('system', 'user');
    expect(result.content).toBe('');
  });
});
