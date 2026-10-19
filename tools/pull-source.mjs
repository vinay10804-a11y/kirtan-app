// Downloads the original recordings from the R2 bucket "kirtans-source" into
// ./source/, keeping their folder structure, so the app can be built without
// the Mac. Files already downloaded at the same size are skipped.
//
//   R2_ENDPOINT=…r2.cloudflarestorage.com R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
//     node tools/pull-source.mjs [bucket]
//
// Then build from it:  node tools/build.mjs source/Kirtans

import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'source');
const BUCKET = process.argv[2] || 'kirtans-source';

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('Set R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (see README, "Working in the cloud").');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT.startsWith('http') ? R2_ENDPOINT : `https://${R2_ENDPOINT}`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function listAll() {
  const objects = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }));
    objects.push(...(page.Contents || []).filter(o => !o.Key.endsWith('/')));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function sizeOf(file) {
  try { return (await fs.stat(file)).size; } catch { return -1; }
}

const objects = await listAll();
const totalGB = objects.reduce((s, o) => s + o.Size, 0) / 1e9;
console.log(`${objects.length} files (${totalGB.toFixed(2)} GB) in ${BUCKET}`);

let done = 0, fetched = 0;
for (const o of objects) {
  const dest = path.join(OUT, o.Key);
  if ((await sizeOf(dest)) !== o.Size) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: o.Key }));
    await pipeline(res.Body, createWriteStream(`${dest}.part`));
    await fs.rename(`${dest}.part`, dest);
    fetched++;
  }
  done++;
  process.stdout.write(`\r  ${done}/${objects.length} (${fetched} downloaded)`);
}
process.stdout.write('\n');
