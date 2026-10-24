import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standaloneRoot = path.join(webRoot, '.next', 'standalone');
const staticSource = path.join(webRoot, '.next', 'static');
const staticTarget = path.join(standaloneRoot, '.next', 'static');

await stat(staticSource);
await mkdir(path.dirname(staticTarget), { recursive: true });
await cp(staticSource, staticTarget, { recursive: true, force: true });

const publicSource = path.join(webRoot, 'public');
try {
  await stat(publicSource);
  await cp(publicSource, path.join(standaloneRoot, 'public'), {
    recursive: true,
    force: true,
  });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

console.log('Standalone static assets are ready.');
