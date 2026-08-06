'use client'

import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: '首页' },
  { href: '/swap', label: '兑换' },
  { href: '/pool', label: '流动性' },
]

export function NavLinks() {
  const pathname = usePathname()

  return (
    <>
      {links.map(({ href, label }) => {
        const isActive = pathname === href
        return (
          <a
            key={href}
            href={href}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              isActive
                ? 'bg-indigo-600 text-white'
                : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
            }`}
          >
            {label}
          </a>
        )
      })}
    </>
  )
}