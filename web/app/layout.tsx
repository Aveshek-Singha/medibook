import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import './globals.css';
import './components.css';
import './overrides.css';
import './product-ui.css';

export const metadata: Metadata = {
  title: 'MediBook | Care that fits your life',
  description: 'Find trusted doctors and book a consultation in a few calm, simple steps.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
