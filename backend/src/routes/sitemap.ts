import { Router } from 'express';
import { db } from '../db/index.js';
import {
  letters,
  collections,
  updatePosts,
  canonicalPersons,
  canonicalPlaces,
  letterPersons,
  letterPlaces,
} from '../db/schema.js';
import { eq, sql, and, lte } from 'drizzle-orm';
import { env } from '../config/env.js';

const router = Router();

// Static pages with their change frequencies and priorities
const STATIC_PAGES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/about', changefreq: 'monthly', priority: '0.5' },
  { path: '/support', changefreq: 'monthly', priority: '0.6' },
  { path: '/collections', changefreq: 'weekly', priority: '0.8' },
  { path: '/blog', changefreq: 'weekly', priority: '0.7' },
];

router.get('/sitemap.xml', async (_req, res) => {
  try {
    const baseUrl = env.SITE_URL.replace(/\/+$/, '');

    const [
      publishedLetters,
      collectionsWithLetters,
      publishedBlogPosts,
      peopleWithLetters,
      placesWithLetters,
    ] = await Promise.all([
      db
        .select({
          id: letters.id,
          updatedAt: letters.updatedAt,
          collectionCode: collections.collectionCode,
        })
        .from(letters)
        .innerJoin(collections, eq(letters.collectionId, collections.id))
        .where(eq(letters.visibility, 'PUBLISHED')),
      db
        .select({
          collectionCode: collections.collectionCode,
          title: collections.title,
          createdAt: collections.createdAt,
          latestUpdate: sql<string>`MAX(${letters.updatedAt})`.as('latest_update'),
        })
        .from(collections)
        .innerJoin(letters, eq(letters.collectionId, collections.id))
        .where(eq(letters.visibility, 'PUBLISHED'))
        .groupBy(collections.id, collections.collectionCode, collections.title, collections.createdAt),
      db
        .select({
          slug: updatePosts.slug,
          updatedAt: updatePosts.updatedAt,
          publishedAt: updatePosts.publishedAt,
        })
        .from(updatePosts)
        .where(
          and(
            eq(updatePosts.status, 'published'),
            lte(updatePosts.publishedAt, new Date())
          )
        ),
      db
        .select({
          id: canonicalPersons.id,
          latestUpdate: sql<string>`MAX(${letters.updatedAt})`.as('latest_update'),
        })
        .from(canonicalPersons)
        .innerJoin(letterPersons, eq(canonicalPersons.id, letterPersons.personId))
        .innerJoin(letters, eq(letterPersons.letterId, letters.id))
        .where(eq(letters.visibility, 'PUBLISHED'))
        .groupBy(canonicalPersons.id),
      db
        .select({
          id: canonicalPlaces.id,
          latestUpdate: sql<string>`MAX(${letters.updatedAt})`.as('latest_update'),
        })
        .from(canonicalPlaces)
        .innerJoin(letterPlaces, eq(canonicalPlaces.id, letterPlaces.placeId))
        .innerJoin(letters, eq(letterPlaces.letterId, letters.id))
        .where(eq(letters.visibility, 'PUBLISHED'))
        .groupBy(canonicalPlaces.id),
    ]);

    // Build XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Static pages
    for (const page of STATIC_PAGES) {
      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}${page.path}</loc>\n`;
      xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
      xml += `    <priority>${page.priority}</priority>\n`;
      xml += '  </url>\n';
    }

    // Collection pages
    for (const collection of collectionsWithLetters) {
      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}/collections/${collection.collectionCode}</loc>\n`;
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
      xml += `    <loc>${baseUrl}/letter/${letter.id}</loc>\n`;
      if (letter.updatedAt) {
        xml += `    <lastmod>${new Date(letter.updatedAt).toISOString().split('T')[0]}</lastmod>\n`;
      }
      xml += '    <changefreq>monthly</changefreq>\n';
      xml += '    <priority>0.6</priority>\n';
      xml += '  </url>\n';
    }

    // Blog detail pages
    for (const post of publishedBlogPosts) {
      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}/blog/${post.slug}</loc>\n`;
      const lastmod = post.updatedAt || post.publishedAt;
      if (lastmod) {
        xml += `    <lastmod>${new Date(lastmod).toISOString().split('T')[0]}</lastmod>\n`;
      }
      xml += '    <changefreq>monthly</changefreq>\n';
      xml += '    <priority>0.7</priority>\n';
      xml += '  </url>\n';
    }

    // Public people pages
    for (const person of peopleWithLetters) {
      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}/people/${person.id}</loc>\n`;
      if (person.latestUpdate) {
        xml += `    <lastmod>${new Date(person.latestUpdate).toISOString().split('T')[0]}</lastmod>\n`;
      }
      xml += '    <changefreq>monthly</changefreq>\n';
      xml += '    <priority>0.5</priority>\n';
      xml += '  </url>\n';
    }

    // Public place pages
    for (const place of placesWithLetters) {
      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}/places/${place.id}</loc>\n`;
      if (place.latestUpdate) {
        xml += `    <lastmod>${new Date(place.latestUpdate).toISOString().split('T')[0]}</lastmod>\n`;
      }
      xml += '    <changefreq>monthly</changefreq>\n';
      xml += '    <priority>0.5</priority>\n';
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
