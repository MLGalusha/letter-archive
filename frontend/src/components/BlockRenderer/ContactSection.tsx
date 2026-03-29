import type { ContactBlock, ContactChannel } from '../../content/blocks';
import Editable from './Editable';

function resolveEmail(settingKey: string, siteSettings?: Record<string, string | undefined> | null): string {
  return siteSettings?.[settingKey] || `${settingKey.replace('contact_', '').replace('_email', '')}@letterarchive.org`;
}

interface Props {
  block: ContactBlock;
  siteSettings?: Record<string, string | undefined> | null;
  editable?: boolean;
  onChange?: (patch: Partial<ContactBlock>) => void;
}

export default function ContactSection({ block, siteSettings, editable, onChange }: Props) {
  const primaryEmail = resolveEmail(block.primaryEmailKey, siteSettings);

  const updateChannel = (index: number, patch: Partial<ContactChannel>) => {
    const channels = block.channels.map((ch, i) =>
      i === index ? { ...ch, ...patch } : ch,
    );
    onChange?.({ channels });
  };

  return (
    <section className="blk-contact" id="contact">
      <Editable
        value={block.eyebrow}
        editable={editable}
        onChange={(v) => onChange?.({ eyebrow: v })}
        tag="div"
        className="blk-eyebrow"
        placeholder="Section label"
      />
      <Editable
        value={block.heading}
        editable={editable}
        onChange={(v) => onChange?.({ heading: v })}
        tag="h2"
        className="blk-section-heading"
        placeholder="Section heading"
      />
      <Editable
        value={block.intro}
        editable={editable}
        onChange={(v) => onChange?.({ intro: v })}
        tag="p"
        className="blk-contact-intro"
        multiline
        placeholder="Intro text"
      />

      {(block.primaryTitle || editable) && (
        <div className="blk-contact-primary blk-card">
          <div className="blk-contact-icon">{'\u2709'}</div>
          <div className="blk-contact-main">
            <Editable
              value={block.primaryTitle}
              editable={editable}
              onChange={(v) => onChange?.({ primaryTitle: v })}
              tag="h3"
              className=""
              placeholder="Contact title"
            />
            <Editable
              value={block.primaryText}
              editable={editable}
              onChange={(v) => onChange?.({ primaryText: v })}
              tag="p"
              className=""
              multiline
              placeholder="Contact description"
            />
            {editable ? (
              <span className="blk-email-btn blk-non-editable">{primaryEmail}</span>
            ) : (
              <a href={`mailto:${primaryEmail}`} className="blk-email-btn">{primaryEmail}</a>
            )}
          </div>
        </div>
      )}

      {block.channels.length > 0 && (
        <div className="blk-contact-channels">
          {block.channels.map((channel, index) => {
            const email = resolveEmail(channel.emailSettingKey, siteSettings);
            return (
              <div key={index} className="blk-channel-card blk-card">
                {channel.eyebrow && <div className="blk-eyebrow">{channel.eyebrow}</div>}
                <Editable
                  value={channel.title}
                  editable={editable}
                  onChange={(v) => updateChannel(index, { title: v })}
                  tag="h3"
                  className=""
                  placeholder="Channel title"
                />
                <Editable
                  value={channel.text}
                  editable={editable}
                  onChange={(v) => updateChannel(index, { text: v })}
                  tag="p"
                  className=""
                  multiline
                  placeholder="Channel description"
                />
                {editable ? (
                  <span className="blk-email-btn blk-non-editable">{email}</span>
                ) : (
                  <a href={`mailto:${email}`} className="blk-email-btn">{email}</a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
