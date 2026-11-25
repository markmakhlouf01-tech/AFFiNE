export const MUAPI_DEFAULT_BASE_URL = 'https://api.muapi.ai/api/v1';

// Muapi model endpoints are path segments such as `flux-dev-image` or
// `kling-v2.1-master-t2v`; anything else is rejected before it reaches the URL.
const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,127}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type MuapiStatus =
  | 'queued'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface MuapiPrediction {
  requestId: string;
  status: MuapiStatus;
  outputs: string[];
  error?: string;
}

export class MuapiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'MuapiError';
  }
}

export function isValidMuapiModel(model: unknown): model is string {
  return typeof model === 'string' && MODEL_PATTERN.test(model);
}

export function isValidMuapiRequestId(id: unknown): id is string {
  return typeof id === 'string' && REQUEST_ID_PATTERN.test(id);
}

function toPrediction(body: unknown, fallbackId?: string): MuapiPrediction {
  const data = (body ?? {}) as Record<string, unknown>;
  const requestId = String(data.request_id ?? data.id ?? fallbackId ?? '');
  if (!requestId) {
    throw new MuapiError('Muapi response did not include a request id');
  }
  const outputs = Array.isArray(data.outputs)
    ? data.outputs.filter((item): item is string => typeof item === 'string')
    : [];
  const error =
    typeof data.error === 'string' && data.error ? data.error : undefined;
  return {
    requestId,
    status: (typeof data.status === 'string'
      ? data.status
      : 'processing') as MuapiStatus,
    outputs,
    ...(error ? { error } : {}),
  };
}

export class MuapiClient {
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    baseUrl: string = MUAPI_DEFAULT_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request(
    path: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      signal,
    });
    const text = await response.text();
    let body: unknown = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      const detail =
        (body as Record<string, unknown> | undefined)?.detail ??
        (body as Record<string, unknown> | undefined)?.error ??
        text;
      throw new MuapiError(
        `Muapi request failed (${response.status}): ${
          typeof detail === 'string' ? detail : JSON.stringify(detail)
        }`.slice(0, 500),
        response.status
      );
    }
    return body;
  }

  /** Submits a generation job and returns immediately with its request id. */
  async submit(
    model: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<MuapiPrediction> {
    if (!isValidMuapiModel(model)) {
      throw new MuapiError(`Invalid Muapi model: ${model}`);
    }
    const body = await this.request(
      `/${model}`,
      { method: 'POST', body: JSON.stringify(input) },
      signal
    );
    return toPrediction(body);
  }

  /** Reads the current state of a job; `outputs` holds result URLs once completed. */
  async result(requestId: string, signal?: AbortSignal) {
    if (!isValidMuapiRequestId(requestId)) {
      throw new MuapiError(`Invalid Muapi request id: ${requestId}`);
    }
    const body = await this.request(
      `/predictions/${requestId}/result`,
      { method: 'GET' },
      signal
    );
    return toPrediction(body, requestId);
  }
}
