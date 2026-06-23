import type { IncomingMessage, ServerResponse } from 'node:http';

import type { TenantContext } from '@uar/core';

import type { DatabaseClient } from '../db/client.js';
import { sendJson } from './http-adapter.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
} as const;

export type JsonObject = { readonly [key: string]: unknown };

export class HttpError extends Error {
  override readonly name = 'HttpError';

  constructor(
    readonly status: number,
    readonly body: JsonObject,
  ) {
    super(readErrorMessage(body));
  }
}

export type HandlerContext = {
  readonly tenantContext: TenantContext;
  readonly db: DatabaseClient;
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly params: Readonly<Record<string, string>>;
  readonly url: URL;
};

export type RouteHandler = (ctx: HandlerContext) => Promise<void> | void;

export type Route = {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly path: string;
  readonly handler: RouteHandler;
};

export function createRouter(routes: readonly Route[]): (req: IncomingMessage, res: ServerResponse) => void {
  const compiledRoutes = routes.map(compileRoute);

  return (req, res) => {
    setCorsHeaders(res);
    void routeRequest(req, res, compiledRoutes);
  };
}

type CompiledRoute = {
  readonly method: Route['method'];
  readonly segments: readonly RouteSegment[];
  readonly handler: RouteHandler;
};

type RouteSegment =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'param'; readonly name: string };

class RouterHandlerContext implements HandlerContext {
  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
    readonly params: Readonly<Record<string, string>>,
    readonly url: URL,
  ) {}

  get tenantContext(): TenantContext {
    throw new HttpError(500, {
      error: 'missing_tenant_context',
      message: 'Tenant context has not been attached',
    });
  }

  get db(): DatabaseClient {
    throw new HttpError(500, {
      error: 'missing_database_client',
      message: 'Database client has not been attached',
    });
  }
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  routes: readonly CompiledRoute[],
): Promise<void> {
  try {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    const match = matchRoute(method, url.pathname, routes);
    if (match === undefined) {
      throw new HttpError(404, {
        error: 'not_found',
        message: `No route for ${method} ${url.pathname}`,
      });
    }

    await match.route.handler(new RouterHandlerContext(req, res, match.params, url));
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, error.body);
      return;
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    sendJson(res, 500, { error: 'internal_server_error', message });
  }
}

function compileRoute(route: Route): CompiledRoute {
  return {
    method: route.method,
    segments: splitPath(route.path).map(compileSegment),
    handler: route.handler,
  };
}

function compileSegment(segment: string): RouteSegment {
  if (segment.startsWith(':')) {
    return { kind: 'param', name: segment.slice(1) };
  }
  return { kind: 'literal', value: segment };
}

function matchRoute(
  method: string,
  pathname: string,
  routes: readonly CompiledRoute[],
): { readonly route: CompiledRoute; readonly params: Readonly<Record<string, string>> } | undefined {
  const requestSegments = splitPath(pathname);

  for (const route of routes) {
    if (route.method !== method || route.segments.length !== requestSegments.length) {
      continue;
    }

    const params = matchSegments(route.segments, requestSegments);
    if (params !== undefined) {
      return { route, params };
    }
  }

  return undefined;
}

function matchSegments(
  routeSegments: readonly RouteSegment[],
  requestSegments: readonly string[],
): Readonly<Record<string, string>> | undefined {
  const params: Record<string, string> = {};

  for (const [index, routeSegment] of routeSegments.entries()) {
    const requestSegment = requestSegments[index];
    if (requestSegment === undefined) {
      return undefined;
    }

    if (routeSegment.kind === 'param') {
      params[routeSegment.name] = requestSegment;
      continue;
    }

    if (routeSegment.value !== requestSegment) {
      return undefined;
    }
  }

  return params;
}

function splitPath(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function setCorsHeaders(res: ServerResponse): void {
  for (const [header, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(header, value);
  }
}

function readErrorMessage(body: JsonObject): string {
  const message = body['message'];
  return typeof message === 'string' ? message : 'HTTP error';
}
