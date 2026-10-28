/**
 * Root layout: fonts (self-hosted, no request to Google), the v2 design
 * system (globals.css), the visitor's language and the municipality's
 * branding colours as CSS variables.
 */
import '@fontsource/montserrat/latin-500.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-700.css';
import '@fontsource/montserrat/latin-800.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/latin-400-italic.css';
import '@fontsource/lora/latin-600.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import PwaRegister from '@/components/PwaRegister';
import { SettingsProvider } from '@/components/providers';
import { I18nProvider } from '@/i18n';
import { getLang } from '@/i18n/server';
import { pageSettings } from '@/lib/server/pageData';
import { shade } from '@/lib/shared/color';

/**
 * Every page is rendered per request: the Content Security Policy nonce (proxy.ts)
 * is new on each request, pages read the language cookie, and the data comes
 * from the database / Redis. Nothing is prerendered while building.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Elbasani Raporton – Bashkia Elbasan', template: '%s · Elbasani Raporton' },
  description: 'Raportoni probleme në qytet dhe kërkoni shërbime nga Bashkia Elbasan. Ndiqni kërkesën tuaj deri në zgjidhje.',
  applicationName: 'Elbasani Raporton',
  icons: { icon: '/icons/favicon-64.png', apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
};

export async function generateViewport(): Promise<Viewport> {
  const { branding } = await pageSettings();
  return { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: branding.headerColor };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [lang, settings] = await Promise.all([getLang(), pageSettings()]);
  const { branding } = settings;
  const brandVars = {
    '--brand-header': branding.headerColor,
    '--brand-footer': branding.footerColor,
    '--brand-button': branding.buttonColor,
    '--brand-button-hover': shade(branding.buttonColor, 0.2),
  } as CSSProperties;
  return (
    <html lang={lang} style={brandVars}>
      <body>
        <I18nProvider initialLang={lang}>
          <SettingsProvider value={settings}>{children}</SettingsProvider>
        </I18nProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
