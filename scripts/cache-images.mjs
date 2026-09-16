import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'shared/catalog.ts');
const imageDirectory = path.join(root, 'public/images');
const catalog = await readFile(catalogPath, 'utf8');
const credits = JSON.parse(await readFile(path.join(root, 'scripts/image-credits.json'), 'utf8'));
const force = process.argv.includes('--force');
const localize = process.argv.includes('--localize');
const ids = [
  ...new Set([...catalog.matchAll(/photo\('(photo-[^']+)'\)/g)].map((match) => match[1])),
];
const rows = [...catalog.matchAll(/id: '([^']+)'[\s\S]*?image: photo\('(photo-[^']+)'\)/g)];
const uses = new Map(
  ids.map((id) => [id, rows.filter((row) => row[2] === id).map((row) => row[1])]),
);
await mkdir(imageDirectory, { recursive: true });

const sourceUrl = (id) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&fm=jpg&w=1200&q=85`;
const assets = ids.map((id) => ({
  id,
  local: `/images/${id}.jpg`,
  source: sourceUrl(id),
  catalogItems: uses.get(id),
  ...credits[id],
}));
const queue = [...assets];
const errors = [];

async function download(asset) {
  const filename = path.join(root, 'public', asset.local);
  if (!force) {
    try {
      const cached = await stat(filename);
      if (cached.size > 1000) {
        console.log(`Cached ${asset.id}`);
        return;
      }
    } catch {
      /* First download. */
    }
  }
  const response = await fetch(asset.source, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.startsWith('image/'))
    throw new Error('Source did not return an image');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000) throw new Error('Downloaded image is unexpectedly small');
  await writeFile(filename, bytes);
  console.log(`Downloaded ${asset.id} (${Math.round(bytes.length / 1024)} KB)`);
}

await Promise.all(
  Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const asset = queue.shift();
      try {
        await download(asset);
      } catch (error) {
        const detail = `${asset.id}: ${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`;
        errors.push(detail);
        console.error(detail);
      }
    }
  }),
);

if (errors.length) {
  console.error(
    `\n${errors.length} image(s) failed. Catalog URLs were not changed. Retry after fixing the source or network access.`,
  );
  process.exitCode = 1;
} else {
  await writeFile(
    path.join(imageDirectory, 'manifest.json'),
    `${JSON.stringify({ provider: 'Unsplash', width: 1200, format: 'jpeg', assets }, null, 2)}\n`,
  );
  const lines = [
    '# Asktara image sources',
    '',
    'Photographs are sourced from public Unsplash image URLs, not from Odessia. All images are cached locally for reliable page loading. Copyright remains with the original photographers. See the [Unsplash License](https://unsplash.com/license).',
    '',
    'Destination photography illustrates each place. Stay images are visual inspiration for fictional listings; they do not identify a real property, its facilities, or its availability. Experience cards reuse the corresponding destination photograph.',
    '',
    'The table records every exact original source URL and its local asset. Some legacy Unsplash CDN URLs do not expose photographer names; none are invented or attributed to Asktara.',
    '',
    'Run `node scripts/cache-images.mjs --localize` to cache missing images and switch the catalog to local paths. Add `--force` to refresh existing images. The script validates HTTP responses and content types, deduplicates downloads, and does not localize the catalog if any image fails.',
    '',
    '| Catalog item(s) | Local file | Original source | Photographer and context |',
    '| --- | --- | --- | --- |',
    ...assets.map(
      (asset) =>
        `| ${asset.catalogItems.join(', ')} | [${asset.id}.jpg](../public${asset.local}) | [Unsplash photograph](${asset.source}) | ${asset.photographer ? `[${asset.photographer}](${asset.page}) — ${asset.subject}` : 'Unsplash contributor; source URL recorded above'} |`,
    ),
    '',
  ];
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'docs/IMAGE_SOURCES.md'), lines.join('\n'));
  if (localize) {
    const updated = catalog.replace(
      /const photo = \(id: string\) => `[^`]+`;/,
      'const photo = (id: string) => `/images/${id}.jpg`;',
    );
    await writeFile(catalogPath, updated);
  }
  console.log(
    `\n${assets.length} unique images ready${localize ? '; catalog uses local files' : ''}. Source manifest: docs/IMAGE_SOURCES.md`,
  );
}
