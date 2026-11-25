import test from 'ava';

import {
  isValidMuapiModel,
  isValidMuapiRequestId,
  MuapiClient,
  MuapiError,
} from '../../plugins/copilot/muapi/client';

type Call = { url: string; init: RequestInit };

function stubFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

test('validates model slugs and request ids', t => {
  t.true(isValidMuapiModel('flux-dev-image'));
  t.true(isValidMuapiModel('kling-v2.1-master-t2v'));
  t.false(isValidMuapiModel('../account/balance'));
  t.false(isValidMuapiModel('flux?x=1'));
  t.false(isValidMuapiModel(''));
  t.true(isValidMuapiRequestId('abc123_XYZ-9'));
  t.false(isValidMuapiRequestId('abc/../x'));
});

test('submits to the model endpoint with the api key header', async t => {
  const { calls, impl } = stubFetch([
    { status: 200, body: { request_id: 'req1', status: 'processing' } },
  ]);
  const client = new MuapiClient('secret', 'https://api.example/api/v1/', impl);

  const prediction = await client.submit('flux-dev-image', { prompt: 'cat' });

  t.deepEqual(prediction, {
    requestId: 'req1',
    status: 'processing',
    outputs: [],
  });
  t.is(calls[0].url, 'https://api.example/api/v1/flux-dev-image');
  t.is(calls[0].init.method, 'POST');
  t.is(calls[0].init.body, JSON.stringify({ prompt: 'cat' }));
  t.is(
    (calls[0].init.headers as Record<string, string>)['x-api-key'],
    'secret'
  );
});

test('reads completed results with output urls', async t => {
  const { calls, impl } = stubFetch([
    {
      status: 200,
      body: {
        id: 'req1',
        status: 'completed',
        outputs: ['https://cdn.example/out.png', 42],
      },
    },
  ]);
  const client = new MuapiClient('secret', undefined, impl);

  const prediction = await client.result('req1');

  t.is(calls[0].url, 'https://api.muapi.ai/api/v1/predictions/req1/result');
  t.is(prediction.status, 'completed');
  t.deepEqual(prediction.outputs, ['https://cdn.example/out.png']);
});

test('surfaces upstream errors with their status', async t => {
  const { impl } = stubFetch([{ status: 402, body: { detail: 'No credits' } }]);
  const client = new MuapiClient('secret', undefined, impl);

  const err = await t.throwsAsync(client.submit('flux-dev-image', {}), {
    instanceOf: MuapiError,
  });
  t.is(err?.status, 402);
  t.regex(err?.message ?? '', /No credits/);
});

test('rejects unsafe model slugs before calling upstream', async t => {
  const { calls, impl } = stubFetch([]);
  const client = new MuapiClient('secret', undefined, impl);

  await t.throwsAsync(client.submit('../keys', {}), { instanceOf: MuapiError });
  t.is(calls.length, 0);
});
