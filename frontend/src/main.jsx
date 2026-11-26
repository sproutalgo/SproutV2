import React from 'react'
import ReactDOM from 'react-dom/client'
import { WalletProvider, WalletManager, NetworkId, WalletId } from '@txnlab/use-wallet-react'
import { inject } from '@vercel/analytics'
import App from './App'
import './index.css'

inject()

// Pin the MAINNET algod node explicitly. Without an explicit networks/algod config,
// use-wallet falls back to built-in defaults, and some wallets (notably Lute) derive
// their displayed network from the active node's genesis — which can mislabel the
// connection as TestNet. Declaring the mainnet node here makes the network unambiguous
// so Lute's connect screen shows MainNet.
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
  networks: {
    [NetworkId.MAINNET]: {
      algod: {
        baseServer: 'https://mainnet-api.4160.nodely.dev',
        port: '443',
        token: '',
      },
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WalletProvider manager={walletManager}>
      <App />
    </WalletProvider>
  </React.StrictMode>
)
