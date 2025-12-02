/**
 * NAV Strikes - Daily Operations Demo
 *
 * This script demonstrates a full day of NAV strike operations on Solana:
 * - Fund token creation with Token 2022 + Metadata
 * - Investor whitelisting
 * - Multiple NAV strikes throughout the day
 * - Subscription and redemption processing
 *
 * ⚠️ EDUCATIONAL REFERENCE ONLY - NOT FOR PRODUCTION USE
 *
 * Prerequisites:
 * 1. Start local validator: solana-test-validator
 * 2. Run: npm run demo
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { NAVStrikeEngine } from "../nav-strike-engine";
import { createTestUSDC, mintTestUSDC, getUSDCBalance } from "../test-usdc";

// Configuration
const RPC_URL = "http://127.0.0.1:8899"; // Local validator

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   ███╗   ██╗ █████╗ ██╗   ██╗    ███████╗████████╗██████╗ ██╗██╗  ██╗███████╗║
║   ████╗  ██║██╔══██╗██║   ██║    ██╔════╝╚══██╔══╝██╔══██╗██║██║ ██╔╝██╔════╝║
║   ██╔██╗ ██║███████║██║   ██║    ███████╗   ██║   ██████╔╝██║█████╔╝ █████╗  ║
║   ██║╚██╗██║██╔══██║╚██╗ ██╔╝    ╚════██║   ██║   ██╔══██╗██║██╔═██╗ ██╔══╝  ║
║   ██║ ╚████║██║  ██║ ╚████╔╝     ███████║   ██║   ██║  ██║██║██║  ██╗███████╗║
║   ╚═╝  ╚═══╝╚═╝  ╚═╝  ╚═══╝      ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚══════╝║
║                                                                              ║
║              NAV STRIKES REFERENCE IMPLEMENTATION                            ║
║                    Running on Local Test Validator                           ║
║                                                                              ║
║   ⚠️  EDUCATIONAL REFERENCE ONLY - NOT FOR PRODUCTION USE                    ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  // Connect to local validator
  console.log("🔗 Connecting to local validator...");
  const connection = new Connection(RPC_URL, "confirmed");

  try {
    const version = await connection.getVersion();
    console.log(`✅ Connected to Solana ${version["solana-core"]}`);
  } catch (error) {
    console.error("❌ Failed to connect to local validator");
    console.error("   Make sure solana-test-validator is running:");
    console.error("   $ solana-test-validator");
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SETUP: Create keypairs and fund accounts
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(
    "\n════════════════════════════════════════════════════════════════"
  );
  console.log(
    "                         SETUP                                   "
  );
  console.log(
    "════════════════════════════════════════════════════════════════"
  );

  // Create keypairs
  const fundAdmin = Keypair.generate();
  const investorA = Keypair.generate();
  const investorB = Keypair.generate();

  console.log("\n👥 Participants:");
  console.log(`   Fund Admin:  ${fundAdmin.publicKey.toBase58()}`);
  console.log(`   Investor A:  ${investorA.publicKey.toBase58()}`);
  console.log(`   Investor B:  ${investorB.publicKey.toBase58()}`);

  // Airdrop SOL to all participants
  console.log("\n💰 Airdropping SOL...");
  for (const [name, keypair] of [
    ["Fund Admin", fundAdmin],
    ["Investor A", investorA],
    ["Investor B", investorB],
  ] as const) {
    const sig = await connection.requestAirdrop(
      keypair.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`   ✅ ${name}: 10 SOL`);
  }

  // Initialize NAV Strike Engine
  const engine = new NAVStrikeEngine(connection, fundAdmin);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Create test USDC
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(
    "\n════════════════════════════════════════════════════════════════"
  );
  console.log(
    "                    STEP 1: CREATE TEST USDC                     "
  );
  console.log(
    "════════════════════════════════════════════════════════════════"
  );

  const usdcMint = await createTestUSDC(connection, fundAdmin, fundAdmin);

  // Mint USDC to investors
  await mintTestUSDC(
    connection,
    usdcMint,
    fundAdmin,
    investorA.publicKey,
    500,
    "Investor A"
  );
  await mintTestUSDC(
    connection,
    usdcMint,
    fundAdmin,
    investorB.publicKey,
    300,
    "Investor B"
  );

  // Mint USDC to fund admin (for redemptions)
  await mintTestUSDC(
    connection,
    usdcMint,
    fundAdmin,
    fundAdmin.publicKey,
    1000,
    "Fund Admin"
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Create Fund Token
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(
    "\n════════════════════════════════════════════════════════════════"
  );
  console.log(
    "                   STEP 2: CREATE FUND TOKEN                     "
  );
  console.log(
    "════════════════════════════════════════════════════════════════"
  );

  const fundMint = await engine.createFundToken(fundAdmin, {
    name: "Example Money Market Fund",
    symbol: "EX-MMF",
    description: "Reference implementation money market fund",
    initialNAV: 1.0,
    strikeSchedule: ["09:30", "12:00", "14:30", "16:00"],
    decimals: 6,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Whitelist Investors
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(
    "\n════════════════════════════════════════════════════════════════"
  );
  console.log(
    "                   STEP 3: WHITELIST INVESTORS                   "
  );
  console.log(
    "════════════════════════════════════════════════════════════════"
  );

  await engine.whitelistInvestor(fundMint, investorA.publicKey, fundAdmin);
  await engine.whitelistInvestor(fundMint, investorB.publicKey, fundAdmin);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Delegate Authority for Subscriptions
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(
    "\n════════════════════════════════════════════════════════════════"
  );
  console.log(
    "                 STEP 4: DELEGATE AUTHORITY                      "
  );
  console.log(
    "════════════════════════════════════════════════════════════════"
  );

  // Investor A delegates $250 USDC for subscription
  await engine.delegateUSDCForSubscription(investorA, usdcMint, 250);

  // Investor B delegates $150 USDC for subscription
  await engine.delegateUSDCForSubscription(investorB, usdcMint, 150);

  // ═══════════════════════════════════════════════════════════════════════════
  // STRIKE 1: 9:30 AM - Process Subscriptions
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n");
  console.log(
    "╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║                    STRIKE 1: 9:30 AM                          ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝"
  );

  // Queue subscription orders
  engine.queueOrder(investorA.publicKey, "subscribe", 250);
  engine.queueOrder(investorB.publicKey, "subscribe", 150);

  // Execute strike at NAV = $1.00
  await engine.executeStrike(fundMint, usdcMint, 1.0);

  // Print balances after strike 1
  await printBalances(connection, fundMint, usdcMint, [
    { name: "Investor A", keypair: investorA },
    { name: "Investor B", keypair: investorB },
    { name: "Fund Admin", keypair: fundAdmin },
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // STRIKE 2: 12:00 PM - More Subscriptions
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n");
  console.log(
    "╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║                   STRIKE 2: 12:00 PM                          ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝"
  );

  // Investor A wants to invest another $100
  await engine.delegateUSDCForSubscription(investorA, usdcMint, 100);
  engine.queueOrder(investorA.publicKey, "subscribe", 100);

  // Execute strike at NAV = $1.01
  await engine.executeStrike(fundMint, usdcMint, 1.01);

  await printBalances(connection, fundMint, usdcMint, [
    { name: "Investor A", keypair: investorA },
    { name: "Investor B", keypair: investorB },
    { name: "Fund Admin", keypair: fundAdmin },
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // STRIKE 3: 2:30 PM - Redemption
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n");
  console.log(
    "╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║                   STRIKE 3: 2:30 PM                           ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝"
  );

  // Investor B wants to redeem 50 shares
  const investorBShares = await getShareBalance(
    connection,
    fundMint,
    investorB.publicKey
  );
  const sharesToRedeem = Math.min(50, investorBShares);

  if (sharesToRedeem > 0) {
    await engine.delegateSharesForRedemption(
      investorB,
      fundMint,
      sharesToRedeem
    );
    engine.queueOrder(investorB.publicKey, "redeem", sharesToRedeem);

    // Execute strike at NAV = $1.02
    await engine.executeStrike(fundMint, usdcMint, 1.02);
  } else {
    console.log("   Investor B has no shares to redeem, skipping...");
  }

  await printBalances(connection, fundMint, usdcMint, [
    { name: "Investor A", keypair: investorA },
    { name: "Investor B", keypair: investorB },
    { name: "Fund Admin", keypair: fundAdmin },
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // STRIKE 4: 4:00 PM - Final Strike
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n");
  console.log(
    "╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║                 STRIKE 4: 4:00 PM (Final)                     ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝"
  );

  // Just update NAV, no orders
  await engine.updateNAV(fundMint, 1.03);

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n");
  console.log(
    "╔══════════════════════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║                              DAILY SUMMARY                                   ║"
  );
  console.log(
    "╠══════════════════════════════════════════════════════════════════════════════╣"
  );
  console.log(
    "║                                                                              ║"
  );
  console.log(
    "║  Trading Day Complete                                                        ║"
  );
  console.log(
    "║                                                                              ║"
  );
  console.log(
    "║  ┌────────────────────────────────────────────────────────────────────────┐  ║"
  );
  console.log(
    "║  │ NAV Performance                                                        │  ║"
  );
  console.log(
    "║  ├────────────────────────────────────────────────────────────────────────┤  ║"
  );
  console.log(
    "║  │   Opening NAV:  $1.00                                                  │  ║"
  );
  console.log(
    "║  │   Closing NAV:  $1.03                                                  │  ║"
  );
  console.log(
    "║  │   Day Change:   +3.00% (+$0.03)                                        │  ║"
  );
  console.log(
    "║  └────────────────────────────────────────────────────────────────────────┘  ║"
  );
  console.log(
    "║                                                                              ║"
  );

  const fundState = engine.getFundState(fundMint);
  console.log(
    "║  ┌────────────────────────────────────────────────────────────────────────┐  ║"
  );
  console.log(
    "║  │ Fund State                                                             │  ║"
  );
  console.log(
    "║  ├────────────────────────────────────────────────────────────────────────┤  ║"
  );
  console.log(
    `║  │   Total AUM:         $${fundState.totalAUM
      .toLocaleString()
      .padEnd(20)}                    │  ║`
  );
  console.log(
    `║  │   Shares Outstanding: ${fundState.totalSharesOutstanding
      .toFixed(2)
      .padEnd(20)}                    │  ║`
  );
  console.log(
    "║  └────────────────────────────────────────────────────────────────────────┘  ║"
  );
  console.log(
    "║                                                                              ║"
  );
  console.log(
    "║  ┌────────────────────────────────────────────────────────────────────────┐  ║"
  );
  console.log(
    "║  │ Cost Comparison                                                        │  ║"
  );
  console.log(
    "║  ├────────────────────────────────────────────────────────────────────────┤  ║"
  );
  console.log(
    "║  │                      Traditional     Solana NAV Strikes                │  ║"
  );
  console.log(
    "║  │   Processing Cost:    ~$180          ~$0.06                            │  ║"
  );
  console.log(
    "║  │   Settlement Time:    T+1/T+2        <1 second                         │  ║"
  );
  console.log(
    "║  │   NAV Strikes/Day:    1              4                                 │  ║"
  );
  console.log(
    "║  │   Pricing:            Unknown til 4PM  Exact NAV at strike             │  ║"
  );
  console.log(
    "║  └────────────────────────────────────────────────────────────────────────┘  ║"
  );
  console.log(
    "║                                                                              ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════════════════════╝"
  );

  // Final balances
  console.log("\n📊 Final Balances:");
  await printBalances(connection, fundMint, usdcMint, [
    { name: "Investor A", keypair: investorA },
    { name: "Investor B", keypair: investorB },
    { name: "Fund Admin", keypair: fundAdmin },
  ]);

  console.log("\n✅ Demo complete!");
  console.log("\n📝 Key Takeaways:");
  console.log(
    "   • Fund shares created with Token 2022 + Metadata (on-chain NAV)"
  );
  console.log("   • Investors whitelisted via freeze/thaw mechanism");
  console.log("   • Subscriptions: USDC → Shares at exact NAV (atomic)");
  console.log("   • Redemptions: Shares → USDC at exact NAV (atomic)");
  console.log("   • Multiple NAV strikes per day (vs once daily traditional)");
  console.log("   • All transactions settled in <1 second\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function getShareBalance(
  connection: Connection,
  fundMint: PublicKey,
  owner: PublicKey
): Promise<number> {
  try {
    const tokenAddress = await getAssociatedTokenAddress(
      fundMint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const account = await getAccount(
      connection,
      tokenAddress,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    return Number(account.amount) / 1e6;
  } catch {
    return 0;
  }
}

async function printBalances(
  connection: Connection,
  fundMint: PublicKey,
  usdcMint: PublicKey,
  participants: Array<{ name: string; keypair: Keypair }>
) {
  console.log(
    "\n┌────────────────────────────────────────────────────────────────┐"
  );
  console.log(
    "│ Balances                                                       │"
  );
  console.log(
    "├────────────────────────────────────────────────────────────────┤"
  );

  for (const { name, keypair } of participants) {
    const shares = await getShareBalance(
      connection,
      fundMint,
      keypair.publicKey
    );
    const usdc = await getUSDCBalance(connection, usdcMint, keypair.publicKey);

    console.log(
      `│ ${name.padEnd(12)} Shares: ${shares
        .toFixed(2)
        .padStart(15)} | USDC: $${usdc.toLocaleString().padStart(12)} │`
    );
  }

  console.log(
    "└────────────────────────────────────────────────────────────────┘"
  );
}

// Run
main().catch((error) => {
  console.error("\n❌ Error:", error);
  process.exit(1);
});
