import { RequestTimeoutError } from '../../provider/error';
import { handleError } from './copilot-client';

export const MUAPI_DEFAULT_IMAGE_MODEL = 'flux-dev-image';
export const MUAPI_DEFAULT_VIDEO_MODEL = 'kling-v3.0-standard-text-to-video';

const POLL_INTERVAL = 2000;
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

type MuapiPrediction = {
  requestId: string;
  status: string;
  outputs: string[];
  error?: string;
};

export type MuapiGenerationOptions = {
  prompt: string;
  model?: string;
  signal?: AbortSignal;
  timeout?: number;
  fetchImpl?: typeof fetch;
  pollInterval?: number;
};

async function request(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
): Promise<MuapiPrediction> {
  const res = await fetchImpl(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw handleError(
      body ?? new Error(`Muapi request failed with status ${res.status}`)
    );
  }
  return body as MuapiPrediction;
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>(resolve => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
  });
}

async function runGeneration({
  prompt,
  model,
  signal,
  timeout = DEFAULT_TIMEOUT,
  fetchImpl = (...args) => fetch(...args),
  pollInterval = POLL_INTERVAL,
}: MuapiGenerationOptions & { model: string }) {
  const deadline = Date.now() + timeout;
  let prediction = await request(fetchImpl, '/api/copilot/muapi/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: { prompt } }),
    signal,
  });

  while (
    prediction.status !== 'completed' &&
    prediction.status !== 'failed' &&
    prediction.status !== 'cancelled'
  ) {
    if (signal?.aborted) return null;
    if (Date.now() > deadline) throw new RequestTimeoutError();
    await wait(pollInterval, signal);
    if (signal?.aborted) return null;
    prediction = await request(
      fetchImpl,
      `/api/copilot/muapi/generations/${encodeURIComponent(prediction.requestId)}`,
      { signal }
    );
  }

  if (prediction.status !== 'completed') {
    throw handleError(
      new Error(prediction.error || `Muapi generation ${prediction.status}`)
    );
  }
  return prediction;
}

/**
 * Generates an image through the server's Muapi proxy and yields the result URL,
 * matching the shape of the copilot image stream (one attachment URL per image).
 */
export function muapiImageStream({
  model = MUAPI_DEFAULT_IMAGE_MODEL,
  ...options
}: MuapiGenerationOptions): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      const prediction = await runGeneration({ ...options, model });
      if (prediction) yield* prediction.outputs;
    },
  };
}

/**
 * Generates a video and yields same-origin URLs of its outputs, served by the
 * server so they can be downloaded into the doc regardless of the CDN's CORS.
 */
export function muapiVideoStream({
  model = MUAPI_DEFAULT_VIDEO_MODEL,
  ...options
}: MuapiGenerationOptions): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      const prediction = await runGeneration({ ...options, model });
      // The AI panel shows a single answer, so only the first output is used.
      if (!prediction?.outputs.length) return;
      const id = encodeURIComponent(prediction.requestId);
      yield `/api/copilot/muapi/generations/${id}/outputs/0`;
    },
  };
}
