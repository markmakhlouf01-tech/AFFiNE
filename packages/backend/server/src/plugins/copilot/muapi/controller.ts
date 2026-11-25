import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import {
  BadRequest,
  CallMetric,
  Config,
  CopilotProviderSideError,
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

    const client = this.client();
    return this.call(() =>
      client.submit(
        model,
        input as Record<string, unknown>,
        getSignal(req).signal
      )
    );
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
}
