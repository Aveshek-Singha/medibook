import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.PORT ??= '3001';
process.env.HOSTNAME ??= '0.0.0.0';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import(
  pathToFileURL(path.join(webRoot, '.next', 'standalone', 'server.js')).href
);
