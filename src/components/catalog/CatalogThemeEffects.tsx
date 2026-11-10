import type { CSSProperties } from 'react';
import type { CatalogAmbience, CatalogThemeId } from '../../lib/catalogPresentation';
import './catalogThemeEffects.css';

interface CatalogThemeEffectsProps {
  theme: CatalogThemeId;
  ambience: CatalogAmbience;
}

const PARTICLES = Array.from({ length: 14 }, (_, index) => index);

export default function CatalogThemeEffects({ theme, ambience }: CatalogThemeEffectsProps) {
  const hasSeasonalDecoration = theme !== 'normal' && theme !== 'custom';
  const showAnimated = hasSeasonalDecoration && ambience.animatedEffects;
  const showHeaderDecoration = hasSeasonalDecoration && ambience.headerDecoration;

  return <>
    {hasSeasonalDecoration && <div
      aria-hidden="true"
      className={`catalog-theme-effects catalog-theme-effects--${theme} catalog-theme-effects--${ambience.intensity}`}
      data-animated={showAnimated ? 'true' : 'false'}
      data-product-decoration={ambience.productDecoration ? 'true' : 'false'}
    >
      {showAnimated && PARTICLES.map(index => <i key={index} className="catalog-theme-particle" style={{ '--particle-index': index } as CSSProperties}/>) }
      {showHeaderDecoration && <div className={`catalog-header-decoration catalog-header-decoration--${theme}`}>
        {theme === 'christmas' && <svg viewBox="0 0 560 40" preserveAspectRatio="none"><path d="M0 5 C100 55 190 -5 280 24 C370 50 460 0 560 18"/><circle cx="48" cy="21" r="4"/><circle cx="123" cy="31" r="4"/><circle cx="198" cy="17" r="4"/><circle cx="280" cy="24" r="4"/><circle cx="358" cy="34" r="4"/><circle cx="440" cy="12" r="4"/><circle cx="520" cy="21" r="4"/></svg>}
        {theme === 'children-day' && <svg viewBox="0 0 560 40" preserveAspectRatio="none"><path d="M0 0 Q70 65 140 0 Q210 65 280 0 Q350 65 420 0 Q490 65 560 0"/><path d="M35 16l18 18m88-18-18 18m88-18 18 18m88-18-18 18m88-18 18 18m88-18-18 18"/></svg>}
        {theme === 'new-year' && <svg viewBox="0 0 560 40" preserveAspectRatio="none"><path d="M0 20H560"/><circle cx="70" cy="20" r="5"/><circle cx="170" cy="20" r="5"/><circle cx="280" cy="20" r="5"/><circle cx="390" cy="20" r="5"/><circle cx="490" cy="20" r="5"/></svg>}
        {!['christmas', 'children-day', 'new-year'].includes(theme) && <span className="catalog-header-decoration__line"/>}
      </div>}
      {showAnimated && theme === 'new-year' && <div className="catalog-fireworks">
        <svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="18"/><circle cx="80" cy="80" r="38"/><path d="M80 6v26m0 96v26M6 80h26m96 0h26M28 28l19 19m66 66 19 19m0-104-19 19M47 113l-19 19"/></svg>
        <svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="16"/><circle cx="80" cy="80" r="36"/><path d="M80 6v26m0 96v26M6 80h26m96 0h26M28 28l19 19m66 66 19 19m0-104-19 19M47 113l-19 19"/></svg>
      </div>}
      {showAnimated && theme === 'children-day' && <div className="catalog-bunting"><svg viewBox="0 0 520 130" preserveAspectRatio="none"><path d="M0 0Q260 150 520 0"/><path d="m35 20 31 10-16 35zm78 38 31 10-16 35zm82 32 31 10-16 35zm82 8 31-10-16 35zm82-26 31-10-16 35zm82-42 31-10-16 35z"/></svg></div>}
    </div>}
  </>;
}
