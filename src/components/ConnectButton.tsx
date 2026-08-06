'use client'

import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { useEffect, useState, useRef } from 'react'

const WALLET_ICONS: Record<string, string> = {
  'MetaMask': '🦊',
  'WalletConnect': '🔗',
}

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connectors, connect, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const [showModal, setShowModal] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭弹窗
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setShowModal(false)
      }
    }
    if (showModal) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModal])

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-[var(--muted-foreground)] bg-[var(--muted)] px-3 py-1.5 rounded-lg font-mono">
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
        <button
          onClick={() => disconnect()}
          className="px-4 py-2 text-sm border border-[var(--card-border)] text-[var(--muted-foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
        >
          断开
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowModal(true)}
        disabled={isPending}
        className={`px-5 py-2 rounded-lg transition-colors font-medium text-sm ${
          isPending
            ? 'bg-gray-400 text-white cursor-not-allowed'
            : 'bg-indigo-600 text-white hover:bg-indigo-700'
        }`}
      >
        {isPending ? '连接中...' : '连接钱包'}
      </button>

      {showModal && (
        <div
          ref={modalRef}
          className="absolute right-0 top-full mt-2 w-64 bg-[var(--card)] border border-[var(--card-border)] rounded-xl shadow-xl z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-[var(--card-border)]">
            <p className="text-sm font-medium">选择钱包</p>
          </div>
          <div className="p-2 space-y-1">
            {connectors.map((connector) => (
              <button
                key={connector.id}
                onClick={() => {
                  connect({ connector })
                  setShowModal(false)
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--muted)] transition-colors text-sm text-left"
              >
                <span className="text-lg">
                  {WALLET_ICONS[connector.name] || '💼'}
                </span>
                <div className="flex-1">
                  <p className="font-medium">{connector.name}</p>
                </div>
              </button>
            ))}
          </div>
          {error && (
            <div className="px-4 py-2 border-t border-[var(--card-border)]">
              <p className="text-xs text-red-500">{error.message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}