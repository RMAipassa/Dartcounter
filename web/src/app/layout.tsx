import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import AppShell from '@/components/AppShell'

export const metadata: Metadata = {
  title: 'Dartcounter Web',
  description: 'Simple realtime dart scoring with friends',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0b1020" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32" />
        <link rel="icon" href="/icons/favicon-16.png" type="image/png" sizes="16x16" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Dartcounter" />
        <meta name="apple-mobile-web-app-title" content="Dartcounter" />
      </head>
      <body>
        <AppShell>
          <div className="container">{children}</div>
        </AppShell>
      </body>
    </html>
  )
}
