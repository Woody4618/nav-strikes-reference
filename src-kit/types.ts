/**
 * NAV Strikes - Type Definitions (Solana Kit)
 *
 * ⚠️ EDUCATIONAL REFERENCE ONLY - NOT FOR PRODUCTION USE
 */

import type {
  Address,
  Rpc,
  RpcSubscriptions,
  SolanaRpcApi,
  SolanaRpcSubscriptionsApi,
} from "@solana/kit";
import type { sendAndConfirmTransactionFactory } from "@solana/kit";

/**
 * Configuration for creating a new fund token
 */
export interface FundTokenConfig {
  /** Display name of the fund */
  name: string;
  /** Token symbol (e.g., "EX-MMF") */
  symbol: string;
  /** Description/URI for the fund */
  description?: string;
  /** Starting NAV price (typically $1.00) */
  initialNAV: number;
  /** Array of strike times in "HH:MM" format (24-hour) */
  strikeSchedule: string[];
  /** Token decimals (default: 6 to match USDC) */
  decimals?: number;
}

/**
 * Current state of the fund
 */
export interface FundState {
  /** Mint address of the fund token */
  fundMint: Address;
  /** Current NAV in USD (6 decimal precision) */
  currentNAV: number;
  /** Timestamp of last NAV strike */
  lastStrikeTime: Date;
  /** Total Assets Under Management in USDC */
  totalAUM: number;
  /** Total shares outstanding */
  totalSharesOutstanding: number;
}

/**
 * Parameters for subscription (USDC → Fund Shares)
 */
export interface SubscriptionParams {
  /** Fund token mint address */
  fundMint: Address;
  /** USDC mint address */
  usdcMint: Address;
  /** Investor's address */
  investor: Address;
  /** Amount of USDC to invest */
  usdcAmount: number;
}

/**
 * Parameters for redemption (Fund Shares → USDC)
 */
export interface RedemptionParams {
  /** Fund token mint address */
  fundMint: Address;
  /** USDC mint address */
  usdcMint: Address;
  /** Investor's address */
  investor: Address;
  /** Number of shares to redeem */
  shareAmount: number;
}

/**
 * Result of a subscription operation
 */
export interface SubscriptionResult {
  /** Transaction signature */
  signature: string;
  /** Amount of USDC invested */
  usdcAmount: number;
  /** Number of shares issued */
  sharesIssued: number;
  /** NAV at time of execution */
  executionNAV: number;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Result of a redemption operation
 */
export interface RedemptionResult {
  /** Transaction signature */
  signature: string;
  /** Number of shares redeemed */
  sharesRedeemed: number;
  /** Amount of USDC paid out */
  usdcPaid: number;
  /** NAV at time of execution */
  executionNAV: number;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Result of a NAV strike execution
 */
export interface StrikeResult {
  /** Strike identifier */
  strikeId: string;
  /** Strike time */
  strikeTime: Date;
  /** NAV used for this strike */
  nav: number;
  /** Number of subscriptions processed */
  subscriptionsProcessed: number;
  /** Total USDC subscribed */
  totalUSDCSubscribed: number;
  /** Total shares minted */
  totalSharesMinted: number;
  /** Number of redemptions processed */
  redemptionsProcessed: number;
  /** Total shares redeemed */
  totalSharesRedeemed: number;
  /** Total USDC paid out */
  totalUSDCPaid: number;
  /** Transaction signatures */
  signatures: string[];
}

/**
 * Queued order for a NAV strike
 */
export interface StrikeOrder {
  /** Order ID */
  orderId: string;
  /** Investor address */
  investor: Address;
  /** Order type */
  orderType: "subscribe" | "redeem";
  /** Amount (USDC for subscribe, shares for redeem) */
  amount: number;
  /** Target strike time */
  strikeTime: Date;
  /** Order status */
  status: "pending" | "executed" | "failed";
}

/**
 * Client configuration for Solana Kit
 */
export interface SolanaClient {
  /** RPC client for making requests */
  rpc: Rpc<SolanaRpcApi>;
  /** RPC subscriptions for WebSocket events */
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
  /** Send and confirm transaction helper */
  sendAndConfirmTransaction: ReturnType<
    typeof sendAndConfirmTransactionFactory
  >;
}
