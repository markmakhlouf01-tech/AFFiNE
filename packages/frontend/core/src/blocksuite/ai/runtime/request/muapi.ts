import { RequestTimeoutError } from '../../provider/error';
import { handleError } from './copilot-client';

export const MUAPI_DEFAULT_IMAGE_MODEL = 'flux-dev-image';

const POLL_INTERVAL = 2000;
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

type MuapiPrediction = {
  requestId: string;
  status: string;
  outputs: string[];
  error?: string;
};

export type MuapiImageOptions = {
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

/**
 * Generates an image through the server's Muapi proxy and yields the result URL,
 * matching the shape of the copilot image stream (one attachment URL per image).
 */
export function muapiImageStream({
  prompt,
  model = MUAPI_DEFAULT_IMAGE_MODEL,
  signal,
  timeout = DEFAULT_TIMEOUT,
  fetchImpl = (...args) => fetch(...args),
  pollInterval = POLL_INTERVAL,
}: MuapiImageOptions): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      const deadline = Date.now() + timeout;
      let prediction = await request(
        fetchImpl,
        '/api/copilot/muapi/generations',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input: { prompt } }),
          signal,
        }
      );

      while (
        prediction.status !== 'completed' &&
        prediction.status !== 'failed' &&
        prediction.status !== 'cancelled'
      ) {
        if (signal?.aborted) return;
        if (Date.now() > deadline) throw new RequestTimeoutError();
        await wait(pollInterval, signal);
        if (signal?.aborted) return;
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
      yield* prediction.outputs;
    },
  };
}
