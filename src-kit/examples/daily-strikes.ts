/**
 * NAV Strikes Demo - Solana Kit Version
 *
 * Demonstrates multiple daily NAV strikes for a money market fund on Solana.
 * Built with @solana/kit (web3.js 2.0)
 *
 * Run with: npm run demo:kit
 * Requires: solana-test-validator running locally
 *
 * ⚠️ EDUCATIONAL REFERENCE ONLY - NOT FOR PRODUCTION USE
 */

import {
  airdropFactory,
  generateKeyPairSigner,
  lamports,
  KeyPairSigner,
  Address,
} from "@solana/kit";
import {
  NAVStrikeEngine,
  createSolanaClient,
  getExplorerLink,
} from "../nav-strike-engine";
import {
  createTestUSDC,
  mintTestUSDC,
  getUSDCBalance,
  getFundShareBalance,
} from "../test-usdc";
import type { SolanaClient } from "../types";

/**
 * Helper to print section headers
 */
function printHeader(title: string): void {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log(`║  ${title.padEnd(60)}║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
}

/**
 * Print final balances for all participants
 */
async function printBalances(
  client: SolanaClient,
  fundMint: Address,
  usdcMint: Address,
  participants: { name: string; address: Address }[]
): Promise<void> {
  console.log("\n┌─────────────────────────────────────────────────────────────────┐");
  console.log("│                    FINAL BALANCES                              │");
  console.log("├─────────────────────────────────────────────────────────────────┤");

  for (const { name, address } of participants) {
    const usdcBalance = await getUSDCBalance(client, usdcMint, address);
    const shareBalance = await getFundShareBalance(client, fundMint, address);
    console.log(
      `│  ${name.padEnd(15)} USDC: $${usdcBalance
        .toFixed(2)
        .padStart(10)}  │  Shares: ${shareBalance.toFixed(2).padStart(10)} │`
    );
  }

  console.log("└─────────────────────────────────────────────────────────────────┘");

  // Cost comparison
  console.log("\n┌─────────────────────────────────────────────────────────────────┐");
  console.log("│                    COST COMPARISON                              │");
  console.log("├─────────────────────────────────────────────────────────────────┤");
  console.log("│                        Traditional          Solana NAV Strikes  │");
  console.log("│  ─────────────────────────────────────────────────────────────  │");
  console.log("│  Strikes/Day:              1 (4PM)              4+ (configurable)│");
  console.log("│  Settlement:              T+1/T+2                   Instant     │");
  console.log("│  Pricing:            Unknown til 4PM     Exact NAV at strike    │");
  console.log("│  Compliance:        Manual KYC/AML         On-chain whitelist   │");
  console.log("│  Settlement Risk:         High                    None          │");
  console.log("│  Audit Trail:           Manual                Blockchain        │");
  console.log("└─────────────────────────────────────────────────────────────────┘");
}

/**
 * Main demo function
 */
async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║   ███╗   ██╗ █████╗ ██╗   ██╗    ███████╗████████╗██████╗       ║
║   ████╗  ██║██╔══██╗██║   ██║    ██╔════╝╚══██╔══╝██╔══██╗      ║
║   ██╔██╗ ██║███████║██║   ██║    ███████╗   ██║   ██████╔╝      ║
║   ██║╚██╗██║██╔══██║╚██╗ ██╔╝    ╚════██║   ██║   ██╔══██╗      ║
║   ██║ ╚████║██║  ██║ ╚████╔╝     ███████║   ██║   ██║  ██║      ║
║   ╚═╝  ╚═══╝╚═╝  ╚═╝  ╚═══╝      ╚══════╝   ╚═╝   ╚═╝  ╚═╝      ║
║                                                                  ║
║        NAV STRIKES - Solana Kit Reference Implementation         ║
║        Built with @solana/kit (web3.js 2.0)                     ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
  `);

  // ─────────────────────────────────────────────────────────────────
  // SETUP: Connect to local validator
  // ─────────────────────────────────────────────────────────────────
  printHeader("SETUP: Connecting to Local Validator");

  const client = await createSolanaClient();
  console.log("✅ Connected to local validator (http://127.0.0.1:8899)");

  // Create keypairs
  const fundAdmin = await generateKeyPairSigner();
  const investorA = await generateKeyPairSigner();
  const investorB = await generateKeyPairSigner();

  console.log(`\n👤 Fund Administrator: ${fundAdmin.address}`);
  console.log(`👤 Investor A: ${investorA.address}`);
  console.log(`👤 Investor B: ${investorB.address}`);

  // Create airdrop function
  const airdrop = airdropFactory({
    rpc: client.rpc,
    rpcSubscriptions: client.rpcSubscriptions,
  });

  // Fund accounts with SOL
  console.log("\n💰 Airdropping SOL to accounts...");

  await airdrop({
    recipientAddress: fundAdmin.address,
    lamports: lamports(10_000_000_000n),
    commitment: "confirmed",
  });
  console.log("   ✅ Fund Admin: 10 SOL");

  await airdrop({
    recipientAddress: investorA.address,
    lamports: lamports(2_000_000_000n),
    commitment: "confirmed",
  });
  console.log("   ✅ Investor A: 2 SOL");

  await airdrop({
    recipientAddress: investorB.address,
    lamports: lamports(2_000_000_000n),
    commitment: "confirmed",
  });
  console.log("   ✅ Investor B: 2 SOL");

  // ─────────────────────────────────────────────────────────────────
  // STEP 1: Create Test USDC
  // ─────────────────────────────────────────────────────────────────
  printHeader("STEP 1: Creating Test USDC");

  const usdcMint = await createTestUSDC(client, fundAdmin, fundAdmin);

  // Mint USDC to participants
  await mintTestUSDC(client, usdcMint, fundAdmin, investorA.address, 500, "Investor A");
  await mintTestUSDC(client, usdcMint, fundAdmin, investorB.address, 300, "Investor B");
  await mintTestUSDC(client, usdcMint, fundAdmin, fundAdmin.address, 1000, "Fund Admin");

  // ─────────────────────────────────────────────────────────────────
  // STEP 2: Create NAV Strike Engine & Fund Token
  // ─────────────────────────────────────────────────────────────────
  printHeader("STEP 2: Creating Fund & NAV Strike Engine");

  const engine = new NAVStrikeEngine(client, fundAdmin, "localnet");

  const fundMint = await engine.createFundToken(fundAdmin, {
    name: "Example Money Market Fund",
    symbol: "EX-MMF",
    description: "Reference implementation money market fund",
    initialNAV: 1.0,
    strikeSchedule: ["09:30", "12:00", "14:30", "16:00"],
    decimals: 6,
  });

  // ─────────────────────────────────────────────────────────────────
  // STEP 3: Whitelist Investors
  // ─────────────────────────────────────────────────────────────────
  printHeader("STEP 3: Whitelisting Investors (KYC/AML)");

  await engine.whitelistInvestor(fundMint, investorA.address, fundAdmin);
  await engine.whitelistInvestor(fundMint, investorB.address, fundAdmin);

  // ─────────────────────────────────────────────────────────────────
  // STRIKE 1: 9:30 AM - Initial Subscriptions
  // ─────────────────────────────────────────────────────────────────
  printHeader("STRIKE 1: 9:30 AM - Initial Subscriptions");

  // Investors delegate USDC and queue orders
  await engine.delegateUSDCForSubscription(investorA, usdcMint, 250);
  engine.queueOrder(investorA.address, "subscribe", 250);

  await engine.delegateUSDCForSubscription(investorB, usdcMint, 150);
  engine.queueOrder(investorB.address, "subscribe", 150);

  // Execute strike at $1.00 NAV
  await engine.executeStrike(fundMint, usdcMint, 1.0);

  // ─────────────────────────────────────────────────────────────────
  // STRIKE 2: 12:00 PM - Additional Subscription
  // ─────────────────────────────────────────────────────────────────
  printHeader("STRIKE 2: 12:00 PM - Additional Subscription");

  // Investor A adds more
  await engine.delegateUSDCForSubscription(investorA, usdcMint, 100);
  engine.queueOrder(investorA.address, "subscribe", 100);

  // Execute strike at $1.01 NAV (slight gain from interest)
  await engine.executeStrike(fundMint, usdcMint, 1.01);

  // ─────────────────────────────────────────────────────────────────
  // STRIKE 3: 2:30 PM - Partial Redemption
  // ─────────────────────────────────────────────────────────────────
  printHeader("STRIKE 3: 2:30 PM - Partial Redemption");

  // Investor B redeems 50 shares
  await engine.delegateSharesForRedemption(investorB, fundMint, 50);
  engine.queueOrder(investorB.address, "redeem", 50);

  // Execute strike at $1.02 NAV
  await engine.executeStrike(fundMint, usdcMint, 1.02);

  // ─────────────────────────────────────────────────────────────────
  // STRIKE 4: 4:00 PM - End of Day
  // ─────────────────────────────────────────────────────────────────
  printHeader("STRIKE 4: 4:00 PM - End of Day");

  // No new orders, just NAV update
  await engine.executeStrike(fundMint, usdcMint, 1.03);

  // ─────────────────────────────────────────────────────────────────
  // FINAL: Print Balances
  // ─────────────────────────────────────────────────────────────────
  printHeader("FINAL RESULTS");

  await printBalances(client, fundMint, usdcMint, [
    { name: "Fund Admin", address: fundAdmin.address },
    { name: "Investor A", address: investorA.address },
    { name: "Investor B", address: investorB.address },
  ]);

  // Print fund state
  const fundState = engine.getFundState(fundMint);
  console.log("\n📊 Fund State:");
  console.log(`   Current NAV: $${fundState.currentNAV.toFixed(6)}`);
  console.log(`   Total AUM: $${fundState.totalAUM.toLocaleString()}`);
  console.log(`   Shares Outstanding: ${fundState.totalSharesOutstanding.toFixed(2)}`);
  console.log(`   Last Strike: ${fundState.lastStrikeTime.toISOString()}`);

  console.log("\n✅ Demo complete! NAV Strikes with Solana Kit working correctly.");
  console.log(
    "   View transactions on Solana Explorer (local validator - links shown above)\n"
  );
}

// Run the demo
main().catch((error) => {
  console.error("❌ Demo failed:", error);
  process.exit(1);
});

