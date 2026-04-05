import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputPath = path.join(rootDir, 'public', 'robots.txt');
const siteUrl = (process.env.VITE_SITE_URL || 'https://voicesthatremain.com').replace(/\/+$/, '');

const content = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin-login

Sitemap: ${siteUrl}/sitemap.xml
`;

fs.writeFileSync(outputPath, content, 'utf8');
process.stdout.write(`Generated robots.txt for ${siteUrl}\n`);
