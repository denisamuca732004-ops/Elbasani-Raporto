import type { Metadata } from 'next';
import { getT } from '@/i18n/server';
import { config } from '@/lib/server/env';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('privacy.title') };
}

export default async function PrivacyPage() {
  const { t } = await getT();
  const sections = ['what', 'why', 'public', 'photos', 'ai', 'keep', 'rights'];
  // The real retention period (CONTACT_RETENTION_DAYS), so the page says what the daily job does.
  let days = 90;
  try { days = config().rules.contactRetentionDays; } catch { /* configuration problem: keep the default */ }
  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <h1>{t('privacy.title')}</h1>
        <p>{t('privacy.intro')}</p>
        {sections.map((s) => (
          <section key={s} style={{ marginTop: 24 }}>
            <h2>{t(`privacy.${s}.title`)}</h2>
            <p>{t(`privacy.${s}.text`, { days })}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
