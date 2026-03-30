import { useState, useEffect, type MouseEvent } from 'react';
import SEO from '../components/SEO';
import { getContentPage } from '../api/client';
import { resolveBlocks } from '../content/blockMigration';
import { getDefaultBlocks } from '../content/defaultBlocks';
import { BlockRenderer } from '../components/BlockRenderer';
import { useSiteSettings } from '../hooks/useSiteSettings';
import { Button } from '../components/common/Button';
import Modal from '../components/common/Modal';
import Footer from '../components/Footer/Footer';
import type { ContentBlock } from '../content/blocks';

export default function SupportPage() {
  const settings = useSiteSettings();
  const [blocks, setBlocks] = useState<ContentBlock[]>(() => getDefaultBlocks('support'));
  const [showUnavailableNotice, setShowUnavailableNotice] = useState(false);

  useEffect(() => {
    getContentPage('support')
      .then((page) => {
        if (page) setBlocks(resolveBlocks('support', page.contentJson));
      })
      .catch(() => {});
  }, []);

  const handleSupportActionClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const actionLink = target.closest<HTMLAnchorElement>('a.blk-card-btn, a.blk-email-btn');
    if (!actionLink) return;

    event.preventDefault();
    setShowUnavailableNotice(true);
  };

  return (
    <div className="body-layout">
      <SEO
        title="Support & Contact"
        description="Help preserve personal letters and historical correspondence. Your support funds digitization, preservation, and public access to the Letter Archive. Get in touch to contribute, research, or volunteer."
        canonicalUrl="/support"
      />
      <div
        className="support-page"
        style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}
        onClickCapture={handleSupportActionClick}
      >
        <BlockRenderer blocks={blocks} siteSettings={settings} />
      </div>
      <Modal
        isOpen={showUnavailableNotice}
        onClose={() => setShowUnavailableNotice(false)}
        title="Still being set up"
        size="sm"
        actions={(
          <Button variant="primary" onClick={() => setShowUnavailableNotice(false)}>
            Close
          </Button>
        )}
      >
        <p style={{ margin: 0 }}>
          Donation and email links on this page are not live yet. They&apos;re still being set up.
        </p>
      </Modal>
      <Footer />
    </div>
  );
}
