import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import AppShell from '@/components/AppShell'

export const metadata: Metadata = {
  title: 'Dartcounter',
  description: 'Live darts scoring for local and remote matches',
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0c0f0c' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icons/favicon-16.png?v=2" type="image/png" sizes="16x16" />
        <link rel="icon" href="/icons/favicon-32.png?v=2" type="image/png" sizes="32x32" />
        <link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml" sizes="any" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png?v=2" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Dartcounter" />
        <meta name="apple-mobile-web-app-title" content="Dartcounter" />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
