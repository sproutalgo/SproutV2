import React from 'react'
import ReactDOM from 'react-dom/client'
import { WalletProvider, WalletManager, NetworkId, WalletId } from '@txnlab/use-wallet-react'
import { inject } from '@vercel/analytics'
import App from './App'
import './index.css'

inject()

// In use-wallet v4 the key is `defaultNetwork` (NOT `network`). The old `network` key was
// silently ignored, so the manager fell back to its documented default of 'testnet' —
// which is why Lute's connect screen showed TestNet. Setting `defaultNetwork` to MAINNET
// fixes it, while keeping use-wallet's built-in network definitions intact (so testnet,
// mainnet, etc. all remain configured — a custom `networks` object that omitted testnet
// is what caused the "Network testnet not found" crash).
const walletManager = new WalletManager({
  wallets: [
    {
      id: WalletId.PERA,
      options: { projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID },
    },
    {
      id: WalletId.DEFLY,
      options: { projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID },
    },
    {
      id: WalletId.LUTE,
      options: { siteName: 'Sprout' },
    },
  ],
  defaultNetwork: NetworkId.MAINNET,
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WalletProvider manager={walletManager}>
      <App />
    </WalletProvider>
  </React.StrictMode>
)
