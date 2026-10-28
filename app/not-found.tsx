import Link from 'next/link';
import Icon from '@/components/Icon';
import { CatalogProvider } from '@/components/providers';
import SiteFrame from '@/components/site/SiteFrame';
import { getT } from '@/i18n/server';
import { pageCatalog } from '@/lib/server/pageData';

export default async function NotFound() {
  const { t } = await getT();
  return (
    <CatalogProvider catalog={await pageCatalog()}>
      <SiteFrame>
        <div className="page">
          <div className="container">
            <div className="done-box">
              <Icon name="search" size={44} />
              <h1 style={{ fontSize: '1.6rem' }}>{t('errors.notFoundTitle')}</h1>
              <p className="muted">{t('errors.notFoundText')}</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <Link href="/" className="btn">{t('errors.home')}</Link>
                <Link href="/raporto" className="btn btn-outline">{t('nav.report')}</Link>
              </div>
            </div>
          </div>
        </div>
      </SiteFrame>
    </CatalogProvider>
  );
}
