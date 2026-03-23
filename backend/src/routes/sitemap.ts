import { Router } from 'express';
import { db } from '../db/index.js';
import { letters, collections } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

const router = Router();

const BASE_URL = 'https://letterarchive.org';

// Static pages with their change frequencies and priorities
const STATIC_PAGES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/about', changefreq: 'monthly', priority: '0.5' },
  { path: '/contact', changefreq: 'monthly', priority: '0.5' },
  { path: '/collections', changefreq: 'weekly', priority: '0.8' },
];

router.get('/sitemap.xml', async (_req, res) => {
  try {
    // Fetch all published letters with their collection codes
    const publishedLetters = await db
      .select({
        id: letters.id,
        updatedAt: letters.updatedAt,
        collectionCode: collections.collectionCode,
      })
      .from(letters)
      .innerJoin(collections, eq(letters.collectionId, collections.id))
      .where(eq(letters.visibility, 'PUBLISHED'));

    // Fetch collections that have at least one published letter
    const collectionsWithLetters = await db
      .select({
        collectionCode: collections.collectionCode,
        title: collections.title,
        createdAt: collections.createdAt,
        latestUpdate: sql<string>`MAX(${letters.updatedAt})`.as('latest_update'),
      })
      .from(collections)
      .innerJoin(letters, eq(letters.collectionId, collections.id))
      .where(eq(letters.visibility, 'PUBLISHED'))
      .groupBy(collections.id, collections.collectionCode, collections.title, collections.createdAt);

    // Build XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Static pages
    for (const page of STATIC_PAGES) {
      xml += '  <url>\n';
      xml += `    <loc>${BASE_URL}${page.path}</loc>\n`;
      xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
      xml += `    <priority>${page.priority}</priority>\n`;
      xml += '  </url>\n';
    }

    // Collection pages
    for (const collection of collectionsWithLetters) {
      xml += '  <url>\n';
      xml += `    <loc>${BASE_URL}/collections/${collection.collectionCode}</loc>\n`;
      if (collection.latestUpdate) {
        xml += `    <lastmod>${new Date(collection.latestUpdate).toISOString().split('T')[0]}</lastmod>\n`;
      }
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.7</priority>\n';
      xml += '  </url>\n';
    }

    // Letter pages
    for (const letter of publishedLetters) {
      xml += '  <url>\n';
      xml += `    <loc>${BASE_URL}/letter/${letter.id}</loc>\n`;
      if (letter.updatedAt) {
        xml += `    <lastmod>${new Date(letter.updatedAt).toISOString().split('T')[0]}</lastmod>\n`;
      }
      xml += '    <changefreq>monthly</changefreq>\n';
      xml += '    <priority>0.6</priority>\n';
      xml += '  </url>\n';
    }

    xml += '</urlset>';

    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.send(xml);
  } catch (err) {
    console.error('Sitemap generation failed:', err);
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
});

export default router;
