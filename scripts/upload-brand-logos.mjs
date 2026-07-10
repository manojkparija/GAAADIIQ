/**
 * Uploads all brand logo SVGs from src/assets/brand-logos/ to Supabase Storage
 * then updates the brands table logo_url with the public CDN URL.
 *
 * Usage:
 *   set SUPABASE_URL=https://xxxx.supabase.co
 *   set SUPABASE_SERVICE_KEY=your-service-role-key
 *   node scripts/upload-brand-logos.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join, basename } from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'brand-logos';
const LOGOS_DIR = resolve('apps/gaadiiq-angular/src/assets/brand-logos');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars first.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some(b => b.name === BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error) throw new Error(`Cannot create bucket: ${error.message}`);
    console.log(`✅  Created storage bucket "${BUCKET}"`);
  } else {
    console.log(`ℹ️   Bucket "${BUCKET}" already exists`);
  }
}

async function uploadFile(filePath) {
  const fileName = basename(filePath);          // e.g. tata.svg
  const slug = fileName.replace('.svg', '');    // e.g. tata
  const fileData = readFileSync(filePath);

  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, fileData, {
      contentType: 'image/svg+xml',
      upsert: true,
    });

  if (upError) {
    console.error(`  ❌  Upload failed for ${fileName}: ${upError.message}`);
    return null;
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
  return { slug, publicUrl: urlData.publicUrl };
}

async function updateBrandUrl(slug, publicUrl) {
  const { error } = await supabase
    .from('brands')
    .update({ logo_url: publicUrl })
    .eq('slug', slug);
  if (error) console.error(`  ❌  DB update failed for ${slug}: ${error.message}`);
}

async function main() {
  console.log('\n🚀  GAADIIQ — Brand Logo Upload to Supabase Storage\n');

  await ensureBucket();

  const files = readdirSync(LOGOS_DIR).filter(f => f.endsWith('.svg'));
  console.log(`\n📁  Found ${files.length} SVG files in ${LOGOS_DIR}\n`);

  let ok = 0;
  for (const file of files) {
    const filePath = join(LOGOS_DIR, file);
    process.stdout.write(`  ⬆️   Uploading ${file} ... `);
    const result = await uploadFile(filePath);
    if (result) {
      await updateBrandUrl(result.slug, result.publicUrl);
      console.log(`✅  ${result.publicUrl}`);
      ok++;
    }
  }

  console.log(`\n✨  Done — ${ok}/${files.length} logos uploaded and DB updated.\n`);
  console.log('The app will now load logos from Supabase Storage automatically.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
