/**
 * NAV Strikes Reference Implementation
 *
 * A reference implementation demonstrating how money market funds can
 * implement multiple daily NAV strikes on Solana using SPL Token 2022.
 *
 * ⚠️ EDUCATIONAL REFERENCE ONLY - NOT FOR PRODUCTION USE
 *
 * @module nav-strikes-reference
 */

// Core Engine
export { NAVStrikeEngine, getExplorerLink, getAddressExplorerLink } from "./nav-strike-engine";
export type { ClusterType } from "./nav-strike-engine";

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
} from "./types";

// Test utilities
export { createTestUSDC, mintTestUSDC, getUSDCBalance } from "./test-usdc";
