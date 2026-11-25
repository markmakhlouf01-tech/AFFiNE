/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test, vi } from 'vitest';

import { GeneralNetworkError, RequestTimeoutError } from '../../provider/error';
import { muapiImageStream, muapiVideoStream } from './muapi';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function collect(stream: AsyncIterable<string>) {
  const items: string[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

describe('muapiImageStream', () => {
  test('submits the prompt, polls until completed and yields output urls', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ requestId: 'req1', status: 'processing', outputs: [] })
      )
      .mockResolvedValueOnce(
        jsonResponse({ requestId: 'req1', status: 'processing', outputs: [] })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          requestId: 'req1',
          status: 'completed',
          outputs: ['https://cdn.example/out.png'],
        })
      );

    const outputs = await collect(
      muapiImageStream({
        prompt: 'a cat',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        pollInterval: 0,
      })
    );

    expect(outputs).toEqual(['https://cdn.example/out.png']);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [submitUrl, submitInit] = fetchImpl.mock.calls[0];
    expect(submitUrl).toBe('/api/copilot/muapi/generations');
    expect(JSON.parse(submitInit.body)).toEqual({
      model: 'flux-dev-image',
      input: { prompt: 'a cat' },
    });
    expect(fetchImpl.mock.calls[1][0]).toBe(
      '/api/copilot/muapi/generations/req1'
    );
  });

  test('turns a failed generation into an AI error', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        requestId: 'req1',
        status: 'failed',
        outputs: [],
        error: 'NSFW content',
      })
    );

    await expect(
      collect(
        muapiImageStream({
          prompt: 'a cat',
          fetchImpl: fetchImpl as unknown as typeof fetch,
        })
      )
    ).rejects.toBeInstanceOf(GeneralNetworkError);
  });

  test('surfaces server errors from the proxy', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          status: 500,
          code: 'Internal Server Error',
          type: 'INTERNAL_SERVER_ERROR',
          name: 'COPILOT_PROVIDER_SIDE_ERROR',
          message: 'Muapi API key is not configured',
        },
        500
      )
    );

    const error = await collect(
      muapiImageStream({
        prompt: 'a cat',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).catch(e => e);

    expect(error).toBeInstanceOf(GeneralNetworkError);
    expect(error.message).toContain('Muapi API key is not configured');
  });

  test('times out when the job never finishes', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ requestId: 'req1', status: 'processing', outputs: [] })
      );

    await expect(
      collect(
        muapiImageStream({
          prompt: 'a cat',
          fetchImpl: fetchImpl as unknown as typeof fetch,
          timeout: 0,
          pollInterval: 0,
        })
      )
    ).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  test('stops quietly when aborted', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(async () => {
      controller.abort();
      return jsonResponse({
        requestId: 'req1',
        status: 'processing',
        outputs: [],
      });
    });

    const outputs = await collect(
      muapiImageStream({
        prompt: 'a cat',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: controller.signal,
      })
    );

    expect(outputs).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('video stream uses the video model and yields a same-origin output url', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        requestId: 'vid 1',
        status: 'completed',
        outputs: ['https://cdn.example/a.mp4', 'https://cdn.example/b.mp4'],
      })
    );

    const outputs = await collect(
      muapiVideoStream({
        prompt: 'a cat surfing',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    );

    expect(outputs).toEqual([
      '/api/copilot/muapi/generations/vid%201/outputs/0',
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      model: 'seedance-lite-t2v',
      input: { prompt: 'a cat surfing' },
    });
  });

  test('video stream yields nothing when the job has no outputs', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ requestId: 'vid1', status: 'completed', outputs: [] })
      );

    const outputs = await collect(
      muapiVideoStream({
        prompt: 'a cat surfing',
        model: 'veo3-fast-text-to-video',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    );

    expect(outputs).toEqual([]);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe(
      'veo3-fast-text-to-video'
    );
  });
});
