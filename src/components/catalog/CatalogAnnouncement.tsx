import type { CSSProperties } from 'react';
import './catalogAnnouncement.css';

interface CatalogAnnouncementProps {
  text: string;
  backgroundColor: string;
  textColor: string;
}

export default function CatalogAnnouncement({ text, backgroundColor, textColor }: CatalogAnnouncementProps) {
  const message = text.trim();
  if (!message) return null;

  return <div className="catalog-announcement" role="note" aria-label="Anuncio del catálogo" style={{ '--catalog-announcement-background': backgroundColor, '--catalog-announcement-ink': textColor } as CSSProperties}>
    <span className="sr-only">{message}</span>
    <span className="catalog-announcement__track" aria-hidden="true"><span>{message}</span><span>{message}</span></span>
  </div>;
}
