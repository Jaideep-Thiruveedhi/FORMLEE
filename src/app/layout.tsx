import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  title: 'Formlee — Make room for what matters',
  description:
    'Organize your student information, track examination applications and get careful assistance with supported forms. You stay in control.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en' className='h-full antialiased font-sans'>
      <body className='min-h-full flex flex-col bg-gray-50'>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
