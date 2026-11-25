import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  BadRequest,
  CallMetric,
  Config,
  CopilotProviderSideError,
  NotFound,
  safeFetch,
  Throttle,
} from '../../../base';
import { CurrentUser } from '../../../core/auth';
import { CopilotEnabled } from '../feature';
import { getSignal } from '../utils';
import {
  isValidMuapiModel,
  isValidMuapiRequestId,
  MuapiClient,
  MuapiError,
} from './client';

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 200 * 1024 * 1024;
const OUTPUT_TIMEOUT_MS = 120_000;
// Results are only returned to the caller, never delivered elsewhere.
const BLOCKED_INPUT_KEYS = new Set(['webhook', 'webhook_url']);

interface MuapiGenerationBody {
  model?: unknown;
  input?: unknown;
}

/**
 * Proxies image / video generation to Muapi (https://muapi.ai) so the API key
 * stays on the server. Jobs are asynchronous: submit, then poll by request id.
 */
@CopilotEnabled()
@Throttle()
@Controller('/api/copilot/muapi')
export class CopilotMuapiController {
  constructor(private readonly config: Config) {}

  private client() {
    const { key, baseUrl } = this.config.copilot.muapi ?? {};
    if (!key) {
      throw new CopilotProviderSideError({
        provider: 'muapi',
        kind: 'config',
        message: 'Muapi API key is not configured',
      });
    }
    return new MuapiClient(key, baseUrl || undefined);
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof MuapiError) {
        throw new CopilotProviderSideError({
          provider: 'muapi',
          kind: err.status ? `http_${err.status}` : 'request',
          message: err.message,
        });
      }
      throw err;
    }
  }

  @Post('/generations')
  @CallMetric('ai', 'muapi_submit')
  async submit(
    @CurrentUser() _user: CurrentUser,
    @Req() req: Request,
    @Body() body: MuapiGenerationBody
  ) {
    const { model, input } = body ?? {};
    if (!isValidMuapiModel(model)) {
      throw new BadRequest('`model` must be a Muapi model endpoint slug');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequest('`input` must be an object of model parameters');
    }
    if (Buffer.byteLength(JSON.stringify(input)) > MAX_INPUT_BYTES) {
      throw new BadRequest('`input` is too large');
    }

    const params = Object.fromEntries(
      Object.entries(input).filter(([key]) => !BLOCKED_INPUT_KEYS.has(key))
    );
    const client = this.client();
    return this.call(() => client.submit(model, params, getSignal(req).signal));
  }

  @Get('/generations/:id')
  @CallMetric('ai', 'muapi_result')
  async result(
    @CurrentUser() _user: CurrentUser,
    @Req() req: Request,
    @Param('id') id: string
  ) {
    if (!isValidMuapiRequestId(id)) {
      throw new BadRequest('Invalid request id');
    }
    const client = this.client();
    return this.call(() => client.result(id, getSignal(req).signal));
  }

  /**
   * Streams a finished output through the server, so the client can store it as
   * a blob without depending on the CDN's CORS headers.
   */
  @Get('/generations/:id/outputs/:index')
  @CallMetric('ai', 'muapi_output')
  async output(
    @CurrentUser() _user: CurrentUser,
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number
  ) {
    if (!isValidMuapiRequestId(id)) {
      throw new BadRequest('Invalid request id');
    }
    const client = this.client();
    const prediction = await this.call(() =>
      client.result(id, getSignal(req).signal)
    );
    const url = prediction.status === 'completed' && prediction.outputs[index];
    if (!url) {
      throw new NotFound('Muapi output not found');
    }

    const upstream = await safeFetch(
      url,
      { method: 'GET' },
      { maxBytes: MAX_OUTPUT_BYTES, timeoutMs: OUTPUT_TIMEOUT_MS }
    );
    if (!upstream.ok) {
      throw new CopilotProviderSideError({
        provider: 'muapi',
        kind: `http_${upstream.status}`,
        message: 'Failed to download Muapi output',
      });
    }
    const type = upstream.headers.get('content-type') ?? '';
    res.set({
      'Content-Type': /^(image|video)\//.test(type)
        ? type
        : 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    });
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }
}
