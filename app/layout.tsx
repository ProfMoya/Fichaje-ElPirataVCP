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
  title: 'Fichaje - El Pirata VCP · Control horario',
  description:
    'Sistema de registro de entrada y salida de personal. Terminal de fichaje con PIN, consulta de horas y panel de administración.',
  robots: { index: false, follow: false },
  icons: {
    icon: '/Logopirata.png',
    apple: '/Logopirata.png',
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
