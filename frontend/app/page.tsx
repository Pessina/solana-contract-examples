'use client';

import { useMemo } from 'react';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { ArrowUpCircle, RefreshCw } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { CopyButton } from '@/components/ui/copy-button';
import { AppHeader } from '@/components/app-header';
import { WelcomeScreen } from '@/components/welcome-screen';
import { BalanceTable } from '@/components/balance-table';
import { PendingDepositsTable } from '@/components/pending-deposits-table';
import { formatAddress } from '@/lib/address-utils';
import { ErrorBoundary } from '@/components/error-boundary';
import { QueryProvider } from '@/providers/query-provider';
import { DepositFlow } from '@/components/deposit-flow';
import {
  useDepositAddress,
  useUserBalances,
  useWithdrawMutation,
  usePendingDeposits,
  useClaimErc20Mutation,
} from '@/hooks/use-solana-queries';

import '@solana/wallet-adapter-react-ui/styles.css';

function DAppContent() {
  const { publicKey } = useWallet();
  const { data: depositAddress, isLoading: isLoadingAddress } =
    useDepositAddress();

  const {
    data: userBalances = [],
    isLoading: isLoadingBalances,
    refetch: refetchBalances,
  } = useUserBalances();

  const {
    data: pendingDeposits = [],
    isLoading: isLoadingPendingDeposits,
    refetch: refetchPendingDeposits,
  } = usePendingDeposits();

  // Debug logging for pending deposits
  console.log('📊 Pending deposits state:', {
    count: pendingDeposits.length,
    isLoading: isLoadingPendingDeposits,
    deposits: pendingDeposits,
  });

  const withdrawMutation = useWithdrawMutation();
  const claimMutation = useClaimErc20Mutation();

  const handleWithdraw = (erc20Address: string, amount: string) => {
    withdrawMutation.mutate({ erc20Address, amount });
  };

  const handleClaim = (requestId: string) => {
    console.log('🎯 Claim button clicked!');
    console.log('  🔑 Request ID:', requestId);
    console.log('  🔄 Mutation pending:', claimMutation.isPending);
    
    claimMutation.mutate({ requestId });
  };

  if (!publicKey) {
    return <WelcomeScreen />;
  }

  return (
    <div className='space-y-6'>
      {/* Welcome message */}
      <div className='text-center py-6'>
        <h2 className='text-xl font-semibold mb-2'>Welcome back!</h2>
        <p className='text-muted-foreground'>
          Wallet connected: {formatAddress(publicKey.toString())}
        </p>
      </div>

      {/* Deposit Address Card */}
      <Card className='hover:shadow-md transition-shadow'>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <div className='flex items-center space-x-3'>
              <div className='w-8 h-8 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center'>
                <ArrowUpCircle className='h-4 w-4 text-green-600 dark:text-green-400' />
              </div>
              <div>
                <CardTitle className='text-base'>
                  Sepolia Deposit Address
                </CardTitle>
                <CardDescription>
                  Send ERC20 tokens to this address on Sepolia testnet, then
                  claim them on Solana
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className='flex items-center space-x-3 p-4 bg-muted/30 rounded-lg border border-dashed'>
            <code className='flex-1 text-sm font-mono break-all select-all'>
              {isLoadingAddress
                ? 'Loading address...'
                : depositAddress || 'Failed to load address'}
            </code>
            {depositAddress && !isLoadingAddress && (
              <CopyButton
                text={depositAddress}
                variant='outline'
                showText
                size='sm'
              />
            )}
            {isLoadingAddress && <LoadingSpinner size='sm' />}
          </div>
        </CardContent>
      </Card>

      {/* Pending Deposits Card */}
      {pendingDeposits.length > 0 && (
        <Card className='hover:shadow-md transition-shadow'>
          <CardHeader>
            <div className='flex items-center justify-between'>
              <div className='flex items-center space-x-3'>
                <div className='w-8 h-8 bg-orange-100 dark:bg-orange-900/20 rounded-full flex items-center justify-center'>
                  <ArrowUpCircle className='h-4 w-4 text-orange-600 dark:text-orange-400' />
                </div>
                <div>
                  <CardTitle className='text-base'>Pending Deposits</CardTitle>
                  <CardDescription>
                    Deposits awaiting chain signature completion
                  </CardDescription>
                </div>
              </div>
              <Button
                size='sm'
                variant='outline'
                onClick={() => refetchPendingDeposits()}
                disabled={isLoadingPendingDeposits}
                className='gap-2'
              >
                {isLoadingPendingDeposits ? (
                  <LoadingSpinner size='sm' />
                ) : (
                  <RefreshCw className='h-4 w-4' />
                )}
                {isLoadingPendingDeposits ? 'Loading' : 'Refresh'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <PendingDepositsTable
              pendingDeposits={pendingDeposits}
              onClaim={handleClaim}
              isLoading={isLoadingPendingDeposits}
              isClaimingMap={{}}
            />
          </CardContent>
        </Card>
      )}

      {/* Balances Card */}
      <Card className='hover:shadow-md transition-shadow'>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <div className='flex items-center space-x-3'>
              <div className='w-8 h-8 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center'>
                <RefreshCw className='h-4 w-4 text-blue-600 dark:text-blue-400' />
              </div>
              <div>
                <CardTitle className='text-base'>Token Balances</CardTitle>
                <CardDescription>
                  ERC20 tokens available for withdrawal
                </CardDescription>
              </div>
            </div>
            <Button
              size='sm'
              variant='outline'
              onClick={() => refetchBalances()}
              disabled={isLoadingBalances}
              className='gap-2'
            >
              {isLoadingBalances ? (
                <LoadingSpinner size='sm' />
              ) : (
                <RefreshCw className='h-4 w-4' />
              )}
              {isLoadingBalances ? 'Loading' : 'Refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <BalanceTable
            balances={userBalances}
            onWithdraw={handleWithdraw}
            isLoading={isLoadingBalances || withdrawMutation.isPending}
          />
          {userBalances.length === 0 && !isLoadingBalances && (
            <div className='mt-6'>
              <DepositFlow onRefreshBalances={refetchBalances} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function App() {
  return (
    <div className='min-h-screen bg-background'>
      <AppHeader />
      <main className='container mx-auto px-4 py-8 max-w-4xl'>
        <ErrorBoundary>
          <DAppContent />
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default function Home() {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <QueryProvider>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <App />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryProvider>
  );
}

// Force client-side rendering for this page
export const dynamic = 'force-dynamic';
