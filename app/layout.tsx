import type { Metadata, Viewport } from 'next'
import { Outfit, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-digits',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Fichaje MAGA · Control horario',
  description:
    'Sistema de registro de entrada y salida de personal. Terminal de fichaje con PIN, consulta de horas y panel de administración.',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0a0e16',
  userScalable: false,
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es-AR" className={`bg-background ${outfit.variable} ${mono.variable}`}>
      <body className="noise-bg bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
