import { useWallet, WalletId } from '@txnlab/use-wallet-react'
import Account from './Account'

const ConnectWallet = ({ openModal, closeModal }) => {
  const { wallets, activeAddress } = useWallet()

  const isKmd = (wallet) => wallet.id === WalletId.KMD

  if (!openModal) return null

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal-box">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, marginBottom: 20 }}>
          Select wallet provider
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activeAddress && (
            <>
              <Account />
              <div className="divider" style={{ margin: '12px 0' }} />
            </>
          )}

          {!activeAddress && wallets?.map((wallet) => (
            <button
              data-test-id={`${wallet.id}-connect`}
              className="btn btn-outline"
              key={`provider-${wallet.id}`}
              style={{ justifyContent: 'flex-start', gap: 12 }}
              onClick={() => {
                wallet.connect()
                closeModal()
              }}
            >
              {!isKmd(wallet) && (
                <img
                  alt={`wallet_icon_${wallet.id}`}
                  src={wallet.metadata.icon}
                  style={{ objectFit: 'contain', width: '28px', height: 'auto' }}
                />
              )}
              <span>{isKmd(wallet) ? 'LocalNet Wallet' : wallet.metadata.name}</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
          <button
            data-test-id="close-wallet-modal"
            className="btn btn-ghost"
            onClick={closeModal}
          >
            Close
          </button>

          {activeAddress && (
            <button
              className="btn btn-outline"
              style={{ color: 'var(--danger)', borderColor: 'rgba(248,113,113,0.3)' }}
              data-test-id="logout"
              onClick={async () => {
                if (wallets) {
                  const activeWallet = wallets.find((w) => w.isActive)
                  if (activeWallet) {
                    await activeWallet.disconnect()
                  } else {
                    localStorage.removeItem('@txnlab/use-wallet:v3')
                    window.location.reload()
                  }
                }
                closeModal()
              }}
            >
              Logout
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ConnectWallet
