// 把 data.js 和 photos/ 加密成可以公开发布的文件：
//   content.enc   加密后的内容
//   p/*.bin       加密后的照片（每张有缩略图和大图两份）
// 密码从 .password 读取。用法：node build.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, webcrypto } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const { subtle } = webcrypto;
const ROOT = dirname(fileURLToPath(import.meta.url));
const ITERATIONS = 600000;
const FULL_PX = 1600;
const THUMB_PX = 600;

const password = readFileSync(join(ROOT, '.password'), 'utf8').trim();
if (!password) throw new Error('.password 是空的');

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(ROOT, 'data.js'), 'utf8'), sandbox);
const data = sandbox.window.OUR_STORY;
if (!data) throw new Error('data.js 里没有找到 window.OUR_STORY');

const baseKey = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
const derive = (salt) => subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
  baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
);

// 密码没变就沿用上次的 salt，这样手机上"记住密码"不会因为更新内容而失效；
// 密码换了（旧内容解不开）才生成新的 salt
let salt = webcrypto.getRandomValues(new Uint8Array(16));
let key = null;
const prevFile = join(ROOT, 'content.enc');
if (existsSync(prevFile)) {
  const prev = JSON.parse(readFileSync(prevFile, 'utf8'));
  const prevSalt = new Uint8Array(Buffer.from(prev.salt, 'base64'));
  const prevKey = await derive(prevSalt);
  const blob = new Uint8Array(Buffer.from(prev.data, 'base64'));
  try {
    await subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(0, 12) }, prevKey, blob.slice(12));
    salt = prevSalt;
    key = prevKey;
  } catch {
    console.log('密码已更换，所有设备需要重新输入新密码');
  }
}
key ??= await derive(salt);

async function encrypt(bytes) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return out;
}

const b64 = (u8) => Buffer.from(u8).toString('base64');

// 照片：压缩成 JPEG，加密后按内容哈希命名
const outDir = join(ROOT, 'p');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir);
const tmp = mkdtempSync(join(tmpdir(), 'our-story-'));

function resize(src, px, name) {
  const dst = join(tmp, name);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', String(px), src, '--out', dst], { stdio: 'ignore' });
  return readFileSync(dst);
}

function dims(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  return {
    w: Number(out.match(/pixelWidth: (\d+)/)[1]),
    h: Number(out.match(/pixelHeight: (\d+)/)[1])
  };
}

let count = 0;
const done = {};
for (const item of data.timeline || []) {
  const refs = [];
  for (const rel of item.photos || []) {
    const src = join(ROOT, rel);
    if (!existsSync(src)) {
      console.warn(`找不到照片，已跳过：${rel}`);
      continue;
    }
    const id = createHash('sha256').update(readFileSync(src)).digest('hex').slice(0, 16);
    if (done[id]) { refs.push(done[id]); continue; }
    const full = resize(src, FULL_PX, `${id}-full.jpg`);
    const thumb = resize(src, THUMB_PX, `${id}-thumb.jpg`);
    writeFileSync(join(outDir, `${id}-full.bin`), await encrypt(full));
    writeFileSync(join(outDir, `${id}-thumb.bin`), await encrypt(thumb));
    done[id] = { id, ...dims(join(tmp, `${id}-full.jpg`)) };
    refs.push(done[id]);
    count++;
  }
  item.photos = refs;
}
rmSync(tmp, { recursive: true, force: true });

const payload = await encrypt(new TextEncoder().encode(JSON.stringify(data)));
writeFileSync(join(ROOT, 'content.enc'), JSON.stringify({
  v: 1,
  iterations: ITERATIONS,
  salt: b64(salt),
  data: b64(payload)
}));

console.log(`已加密：内容 1 份，照片 ${count} 张`);
