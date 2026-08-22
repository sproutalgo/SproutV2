import { useWallet } from '@txnlab/use-wallet-react'
import { useEffect, useState } from 'react'
import { algodClient, formatAlgo, shortAddr } from '../utils/algorand'

const Account = () => {
  const { activeAddress } = useWallet()
  const [balance, setBalance] = useState(null)

  useEffect(() => {
    if (!activeAddress) return
    algodClient.accountInformation(activeAddress).do()
      .then(info => setBalance(info.amount))
      .catch(() => setBalance(null))
  }, [activeAddress])

  if (!activeAddress) return null

  return (
    <div style={{
      background: 'var(--bg)',
      border: '1px solid var(--border-accent)',
      borderRadius: 'var(--radius)',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--success)', fontSize: 10 }}>●</span>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Connected</span>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
        {activeAddress}
      </div>
      {balance !== null && (
        <div style={{ fontSize: 13, color: 'var(--algo-teal)' }}>
          {formatAlgo(balance)} ALGO
        </div>
      )}
    </div>
  )
}

export default Account
