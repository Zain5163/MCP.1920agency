import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'AdsPilot',
  description: 'Publish and schedule social posts across Meta platforms.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
