import React from 'react'
import ReactDOM from 'react-dom/client'
import { WalletProvider, WalletManager, NetworkId, WalletId } from '@txnlab/use-wallet-react'
import { inject } from '@vercel/analytics'
import App from './App'
import './index.css'

inject()

// In use-wallet v4 the network key is `defaultNetwork` (NOT `network`). The old `network`
// key was silently ignored, so the manager defaulted to 'testnet'.
//
// resetNetwork: true forces the default network (mainnet) on EVERY page load, ignoring any
// network persisted in localStorage. This is required because earlier builds persisted
// "activeNetwork":"testnet" for users; without resetNetwork that stale value is restored on
// load and overrides defaultNetwork — which is what kept Lute showing TestNet. Sprout is
// mainnet-only, so always resetting to mainnet is the intended behavior.
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
  options: { resetNetwork: true },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WalletProvider manager={walletManager}>
      <App />
    </WalletProvider>
  </React.StrictMode>
)
