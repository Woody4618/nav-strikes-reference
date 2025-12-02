/**
 * NAV Strikes Reference Implementation - Solana Kit Version
 *
 * Built with @solana/kit (web3.js 2.0)
 *
 * @packageDocumentation
 */

// Core engine
export {
  NAVStrikeEngine,
  createSolanaClient,
  getExplorerLink,
  getAddressExplorerLink,
} from "./nav-strike-engine";
export type { ClusterType } from "./nav-strike-engine";

// Test utilities
export {
  createTestUSDC,
  mintTestUSDC,
  getUSDCBalance,
  getFundShareBalance,
} from "./test-usdc";

// Types
export type {
  FundTokenConfig,
  FundState,
  SubscriptionParams,
  RedemptionParams,
  SubscriptionResult,
  RedemptionResult,
  StrikeResult,
  StrikeOrder,
  SolanaClient,
} from "./types";

