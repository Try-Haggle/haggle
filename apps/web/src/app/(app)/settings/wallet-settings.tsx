"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Alert, Badge, Button, Checkbox, Select } from "@/components/ui";

interface Wallet {
  id: string;
  wallet_address: string;
  network: string;
  role: string;
  is_primary: boolean;
  created_at: string;
}

export function WalletSettings() {
  const { address, isConnected } = useAccount();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [network, setNetwork] = useState<"base" | "base-sepolia">("base");
  const [role, setRole] = useState<"buyer" | "seller" | "both">("both");
  const [isPrimary, setIsPrimary] = useState(true);

  const fetchWallets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wallets");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to fetch wallets");
      }
      const data = await res.json();
      setWallets(data.wallets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  async function handleSaveWallet() {
    if (!address) return;
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_address: address,
          network,
          role,
          is_primary: isPrimary,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save wallet");
      }
      setSuccess("Wallet saved successfully");
      await fetchWallets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteWallet(walletId: string) {
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/wallets/${walletId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete wallet");
      }
      setSuccess("Wallet removed");
      await fetchWallets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-ink">Wallet Settings</h2>
        <p className="text-sm text-ink-muted mt-1">
          Connect and manage your crypto wallets for USDC payments.
        </p>
      </div>

      {/* Connect wallet */}
      <div className="border border-line rounded-lg p-4 space-y-4">
        <h3 className="text-sm font-medium text-ink-secondary">Connect Wallet</h3>
        <ConnectButton />

        {isConnected && address && (
          <div className="space-y-3 pt-2 border-t border-line-subtle">
            <div className="bg-surface-sunken rounded p-3">
              <p className="text-xs text-ink-muted">Connected address</p>
              <p className="font-mono text-sm">{address}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="wallet-network"
                  className="block text-xs font-medium text-ink-secondary mb-1"
                >
                  Network
                </label>
                <Select
                  id="wallet-network"
                  value={network}
                  onChange={(e) => setNetwork(e.target.value as "base" | "base-sepolia")}
                >
                  <option value="base">Base (Mainnet)</option>
                  <option value="base-sepolia">Base Sepolia (Testnet)</option>
                </Select>
              </div>

              <div>
                <label
                  htmlFor="wallet-role"
                  className="block text-xs font-medium text-ink-secondary mb-1"
                >
                  Role
                </label>
                <Select
                  id="wallet-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as "buyer" | "seller" | "both")}
                >
                  <option value="both">Buyer & Seller</option>
                  <option value="buyer">Buyer only</option>
                  <option value="seller">Seller only</option>
                </Select>
              </div>
            </div>

            <Checkbox
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              label="Set as primary wallet"
            />

            <Button fullWidth onClick={handleSaveWallet} loading={isLoading}>
              {isLoading ? "Saving..." : "Save Wallet"}
            </Button>
          </div>
        )}
      </div>

      {/* Messages */}
      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      {/* Saved wallets */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-ink-secondary">Saved Wallets ({wallets.length})</h3>

        {wallets.length === 0 ? (
          <p className="text-sm text-ink-muted py-4 text-center">No wallets saved yet</p>
        ) : (
          <div className="space-y-2">
            {wallets.map((wallet) => (
              <div
                key={wallet.id}
                className="flex items-center justify-between border border-line rounded-lg p-3"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm truncate">
                      {wallet.wallet_address.slice(0, 6)}...{wallet.wallet_address.slice(-4)}
                    </span>
                    {wallet.is_primary && (
                      <Badge tone="info" size="sm">
                        Primary
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-ink-muted">
                    {wallet.network} · {wallet.role}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteWallet(wallet.id)}
                  disabled={isLoading}
                  className="ml-3 shrink-0 text-error text-xs hover:text-error/80 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
