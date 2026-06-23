import { createServer } from 'node:http';

import { createDescopeSessionVerifier } from './auth/descope.js';
import { loadAuthzFlags } from './config/flags.js';
import { createDatabaseClient } from './db/client.js';
import { createApp } from './server/app.js';

const flags = loadAuthzFlags(process.env);
const verifier = process.env.DESCOPE_PROJECT_ID
  ? createDescopeSessionVerifier({ projectId: process.env.DESCOPE_PROJECT_ID })
  : undefined;

if (!flags.stubAuthz && verifier === undefined) {
  throw new Error('DESCOPE_PROJECT_ID is required unless STUB_AUTHZ=true');
}

const { db } = createDatabaseClient();
const port = Number(process.env.PORT ?? 3001);
const listener = createApp({ verifier, flags, db });

createServer(listener).listen(port, () => {
  console.log(`@uar/api listening on port ${port}`);
});
