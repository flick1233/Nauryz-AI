import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nauryz AI — Агро-ассистент',
  description: 'ИИ-помощник для казахстанских фермеров',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#f5ead8" />
      </head>
      <body>{children}</body>
    </html>
  );
}
