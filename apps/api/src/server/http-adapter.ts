import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AuthzRequest } from '../middleware/authz.js';
import { HttpError } from './router.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
} as const;

export function toAuthzRequest(req: IncomingMessage): AuthzRequest {
  return {
    headers: {
      get: (name) => readHeader(req, name),
    },
  };
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new HttpError(400, {
        error: 'bad_request',
        message: 'Request body is not valid JSON',
      });
    }

    throw error;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

export function sendText(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  res.writeHead(status, { ...CORS_HEADERS, ...extraHeaders, 'Content-Type': contentType });
  res.end(body);
}

function readHeader(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  if (value === undefined) {
    return null;
  }
  return Array.isArray(value) ? value.join(', ') : value;
}
