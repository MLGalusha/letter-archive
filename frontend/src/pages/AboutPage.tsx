import SEO from '../components/SEO';
import { listCollections, type CollectionInfo } from '../api/collections';
import { getContentPage } from '../api/client';
import { resolveBlocks } from '../content/blockMigration';
import { getDefaultBlocks } from '../content/defaultBlocks';
import { BlockRenderer } from '../components/BlockRenderer';
import Footer from '../components/Footer/Footer';
import { useAsync } from '../hooks/useAsync';

export default function AboutPage() {
  const { data } = useAsync(async () => {
    const [collectionsResult, contentResult] = await Promise.allSettled([
      listCollections(),
      getContentPage('about'),
    ]);

    let stats: { letters: number; collections: number } | null = null;
    if (collectionsResult.status === 'fulfilled') {
      const collections = collectionsResult.value as CollectionInfo[];
      const visible = collections.filter((c) => (c.letterCount || 0) > 0);
      const letters = visible.reduce((sum, c) => sum + (c.letterCount || 0), 0);
      stats = { collections: visible.length, letters };
    }

    const contentJson = contentResult.status === 'fulfilled' && contentResult.value
      ? contentResult.value.contentJson
      : null;
    const blocks = resolveBlocks('about', contentJson);

    return { stats, blocks };
  }, []);

  return (
    <div className="body-layout">
      <SEO
        title="About"
        description="Learn about Letter Archive -- a project to digitize, transcribe, and preserve personal letters and historical correspondence for future generations."
        canonicalUrl="/about"
      />
      <div className="about-page" style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
        <BlockRenderer
          blocks={data?.blocks ?? getDefaultBlocks('about')}
          liveStats={data?.stats}
        />
      </div>
      <Footer />
    </div>
  );
}
