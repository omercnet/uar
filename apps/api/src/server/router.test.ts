import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HttpError, createRouter, type Route } from './router.js';

const CORS_HEADERS = {
  origin: 'access-control-allow-origin',
  methods: 'access-control-allow-methods',
  headers: 'access-control-allow-headers',
} as const;

const testRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/conflicts',
    handler: () => {
      throw new HttpError(409, { error: 'conflict', message: 'Route conflict' });
    },
  },
  {
    method: 'GET',
    path: '/campaigns/:campaignId/items/:itemId',
    handler: (ctx) => {
      ctx.res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      ctx.res.end(JSON.stringify({ params: ctx.params }));
    },
  },
];

describe('node:http router', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Given
    server = createServer(createRouter(testRoutes));
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP listener');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it('returns 204 with CORS headers when preflight OPTIONS arrives', async () => {
    // When
    const response = await fetch(`${baseUrl}/anything`, { method: 'OPTIONS' });

    // Then
    expect(response.status).toBe(204);
    expect(response.headers.get(CORS_HEADERS.origin)).toBe('*');
    expect(response.headers.get(CORS_HEADERS.methods)).toBe('GET,POST,PATCH,OPTIONS');
    expect(response.headers.get(CORS_HEADERS.headers)).toBe('Authorization,Content-Type');
  });

  it('returns ok status when health endpoint is requested', async () => {
    // When
    const response = await fetch(`${baseUrl}/health`);

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get(CORS_HEADERS.origin)).toBe('*');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('returns JSON 404 with CORS headers when no route matches', async () => {
    // When
    const response = await fetch(`${baseUrl}/missing`);

    // Then
    expect(response.status).toBe(404);
    expect(response.headers.get(CORS_HEADERS.origin)).toBe('*');
    expect(await response.json()).toEqual({ error: 'not_found', message: 'No route for GET /missing' });
  });

  it('returns HttpError status and body when route handler throws HttpError', async () => {
    // When
    const response = await fetch(`${baseUrl}/conflicts`);

    // Then
    expect(response.status).toBe(409);
    expect(response.headers.get(CORS_HEADERS.origin)).toBe('*');
    expect(await response.json()).toEqual({ error: 'conflict', message: 'Route conflict' });
  });

  it('extracts colon-prefixed route params for matched handlers', async () => {
    // When
    const response = await fetch(`${baseUrl}/campaigns/campaign-1/items/item-2`);

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get(CORS_HEADERS.origin)).toBe('*');
    expect(await response.json()).toEqual({
      params: {
        campaignId: 'campaign-1',
        itemId: 'item-2',
      },
    });
  });
});
