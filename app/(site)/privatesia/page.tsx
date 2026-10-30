import type { Metadata } from 'next';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('privacy.title') };
}

export default async function PrivacyPage() {
  const { t } = await getT();
  const sections = ['what', 'why', 'public', 'photos', 'ai', 'account', 'keep', 'rights'];
  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <h1>{t('privacy.title')}</h1>
        <p>{t('privacy.intro')}</p>
        {sections.map((s) => (
          <section key={s} style={{ marginTop: 24 }}>
            <h2>{t(`privacy.${s}.title`)}</h2>
            <p>{t(`privacy.${s}.text`)}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
