import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Nauryz AI — Агро-ассистент',
  description: 'ИИ-помощник для казахстанских фермеров',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0d1a0f" />
      </head>
      <body style={{ margin: 0, background: '#0d1a0f' }}>{children}</body>
    </html>
  );
}
