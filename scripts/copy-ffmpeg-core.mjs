// Copies the single-threaded ffmpeg.wasm core into public/ so it is served
// same-origin (GitHub Pages cannot set COOP/COEP headers, and same-origin
// avoids CDN/CORS issues entirely).
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const dst = join(root, 'public', 'ffmpeg');

mkdirSync(dst, { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  copyFileSync(join(src, f), join(dst, f));
}
console.log('ffmpeg core copied to public/ffmpeg/');
