import { useState, useEffect } from 'react';
import SEO from '../components/SEO';
import { getContentPage } from '../api/client';
import { resolveBlocks } from '../content/blockMigration';
import { getDefaultBlocks } from '../content/defaultBlocks';
import { BlockRenderer } from '../components/BlockRenderer';
import { useSiteSettings } from '../hooks/useSiteSettings';
import Footer from '../components/Footer/Footer';
import type { ContentBlock } from '../content/blocks';

export default function SupportPage() {
  const settings = useSiteSettings();
  const [blocks, setBlocks] = useState<ContentBlock[]>(() => getDefaultBlocks('support'));

  useEffect(() => {
    getContentPage('support')
      .then((page) => {
        if (page) setBlocks(resolveBlocks('support', page.contentJson));
      })
      .catch(() => {});
  }, []);

  return (
    <div className="body-layout">
      <SEO
        title="Support & Contact"
        description="Help preserve personal letters and historical correspondence. Your support funds digitization, preservation, and public access to the Letter Archive. Get in touch to contribute, research, or volunteer."
        canonicalUrl="/support"
      />
      <div className="support-page" style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
        <BlockRenderer blocks={blocks} siteSettings={settings} />
      </div>
      <Footer />
    </div>
  );
}
