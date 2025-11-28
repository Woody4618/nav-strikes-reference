/**
 * NAV Strikes Engine - Reference Implementation
 *
 * This implementation demonstrates NAV strikes for money market funds on Solana using:
 * - SPL Token 2022 with Default Account State extension for fund shares
 * - Standard USDC for settlement
 * - Atomic transactions for subscription/redemption
 * - Delegated authority pattern for fund administrator
 *
 * ⚠️ IMPORTANT: This is a reference implementation for educational purposes.
 * Do NOT use in production without proper audits and security reviews.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  approve,
  thawAccount,
  freezeAccount,
  getAccount,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction,
  createMintToInstruction,
  createBurnInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeDefaultAccountStateInstruction,
  createInitializeMetadataPointerInstruction,
  AccountState,
  LENGTH_SIZE,
  TYPE_SIZE,
} from "@solana/spl-token";
import {
  pack,
  createInitializeInstruction,
  createUpdateFieldInstruction,
  type TokenMetadata,
} from "@solana/spl-token-metadata";
import {
  FundTokenConfig,
  FundState,
  SubscriptionParams,
  RedemptionParams,
  SubscriptionResult,
  RedemptionResult,
  StrikeResult,
  StrikeOrder,
} from "./types";

/**
 * Cluster type for explorer links
 */
export type ClusterType = "mainnet-beta" | "devnet" | "testnet" | "localnet";

/**
 * Generate Solana Explorer link for a transaction
 */
export function getExplorerLink(
  signature: string,
  cluster: ClusterType = "localnet"
): string {
  const baseUrl = "https://explorer.solana.com/tx";
  if (cluster === "localnet") {
    // For local validator, use custom RPC param
    return `${baseUrl}/${signature}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`;
  }
  return `${baseUrl}/${signature}?cluster=${cluster}`;
}

/**
 * Generate Solana Explorer link for an account/address
 */
export function getAddressExplorerLink(
  address: string,
  cluster: ClusterType = "localnet"
): string {
  const baseUrl = "https://explorer.solana.com/address";
  if (cluster === "localnet") {
    return `${baseUrl}/${address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`;
  }
  return `${baseUrl}/${address}?cluster=${cluster}`;
}

/**
 * NAV Strike Engine
 *
 * Manages the lifecycle of a money market fund on Solana:
 * - Creates fund tokens with Token 2022 metadata extensions
 * - Updates NAV at scheduled strike times
 * - Processes subscription and redemption orders atomically
 */
export class NAVStrikeEngine {
  private connection: Connection;
  private fundAdministrator: Keypair;
  private cluster: ClusterType;

  // Fund state
  private currentNAV: number = 1.0;
  private totalAUM: number = 0;
  private totalSharesOutstanding: number = 0;
  private strikeSchedule: string[] = [];
  private lastStrikeTime: Date = new Date();

  // Order queue
  private pendingOrders: StrikeOrder[] = [];
  private orderCounter: number = 0;

  constructor(
    connection: Connection,
    fundAdministrator: Keypair,
    cluster: ClusterType = "localnet"
  ) {
    this.connection = connection;
    this.fundAdministrator = fundAdministrator;
    this.cluster = cluster;
  }

  /**
   * Get explorer link for a transaction signature
   */
  getTxExplorerLink(signature: string): string {
    return getExplorerLink(signature, this.cluster);
  }

  /**
   * Get explorer link for an address
   */
  getAddressLink(address: string): string {
    return getAddressExplorerLink(address, this.cluster);
  }

  /**
   * Creates a fund share token using Token-2022 with Default Account State and Metadata extensions
   * Fund shares are frozen by default and require whitelisting
   * Metadata stores NAV and fund information on-chain
   */
  async createFundToken(
    issuer: Keypair,
    config: FundTokenConfig
  ): Promise<PublicKey> {
    console.log(
      "\n╔══════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║              NAV STRIKE - FUND CREATION                        ║"
    );
    console.log(
      "╚══════════════════════════════════════════════════════════════╝"
    );
    console.log(`\n🏗️  Creating fund token with Token-2022 + Metadata...`);
    console.log(`   Name: ${config.name}`);
    console.log(`   Symbol: ${config.symbol}`);
    console.log(`   Initial NAV: $${config.initialNAV.toFixed(6)}`);
    console.log(`   Strike Schedule: ${config.strikeSchedule.join(", ")}`);

    // Generate new keypair for the mint
    const mintKeypair = Keypair.generate();
    const decimals = config.decimals ?? 6;

    // Create the metadata object with MAX SIZE values to pre-allocate space
    // This ensures we have enough rent for future updates
    const maxSizeMetadata: TokenMetadata = {
      mint: mintKeypair.publicKey,
      name: config.name,
      symbol: config.symbol,
      uri: config.description || "",
      additionalMetadata: [
        // Use max expected lengths for proper space allocation
        ["currentNAV", "999999.999999"], // Max NAV format
        ["lastStrikeTime", "2099-12-31T23:59:59.999Z"], // Max ISO timestamp
        ["strikeSchedule", JSON.stringify(config.strikeSchedule)],
        ["totalAUM", "999999999999999.99"], // Max AUM (quadrillions)
        ["fundType", "Money Market Fund"],
      ],
    };

    // Calculate sizes using MAX metadata for rent
    const maxMetadataLen = pack(maxSizeMetadata).length;
    const metadataExtension = TYPE_SIZE + LENGTH_SIZE;
    const extensions = [
      ExtensionType.DefaultAccountState,
      ExtensionType.MetadataPointer,
    ];
    const spaceWithoutMetadataExtension = getMintLen(extensions);

    // Calculate rent with extra buffer for safety (add 500 bytes)
    const lamports = await this.connection.getMinimumBalanceForRentExemption(
      spaceWithoutMetadataExtension + maxMetadataLen + metadataExtension + 500
    );

    // Actual initial metadata values
    const initialMetadata: [string, string][] = [
      ["currentNAV", config.initialNAV.toFixed(6)],
      ["lastStrikeTime", new Date().toISOString()],
      ["strikeSchedule", JSON.stringify(config.strikeSchedule)],
      ["totalAUM", "0.00"],
      ["fundType", "Money Market Fund"],
    ];

    // Build transaction
    const transaction = new Transaction().add(
      // 1. Create account
      SystemProgram.createAccount({
        fromPubkey: issuer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: spaceWithoutMetadataExtension,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      // 2. Initialize metadata pointer
      createInitializeMetadataPointerInstruction(
        mintKeypair.publicKey,
        this.fundAdministrator.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      ),
      // 3. Initialize default account state (frozen for compliance)
      createInitializeDefaultAccountStateInstruction(
        mintKeypair.publicKey,
        AccountState.Frozen,
        TOKEN_2022_PROGRAM_ID
      ),
      // 4. Initialize mint
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        decimals,
        this.fundAdministrator.publicKey, // mint authority
        this.fundAdministrator.publicKey, // freeze authority
        TOKEN_2022_PROGRAM_ID
      ),
      // 5. Initialize metadata
      createInitializeInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        mint: mintKeypair.publicKey,
        metadata: mintKeypair.publicKey,
        name: config.name,
        symbol: config.symbol,
        uri: config.description || "",
        mintAuthority: this.fundAdministrator.publicKey,
        updateAuthority: this.fundAdministrator.publicKey,
      })
    );

    // 6. Add custom metadata fields with initial values
    for (const [field, value] of initialMetadata) {
      if (value) {
        transaction.add(
          createUpdateFieldInstruction({
            programId: TOKEN_2022_PROGRAM_ID,
            metadata: mintKeypair.publicKey,
            updateAuthority: this.fundAdministrator.publicKey,
            field: field,
            value: value,
          })
        );
      }
    }

    // Send transaction
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [issuer, mintKeypair, this.fundAdministrator],
      { commitment: "confirmed" }
    );

    // Update internal state
    this.currentNAV = config.initialNAV;
    this.strikeSchedule = config.strikeSchedule;
    this.lastStrikeTime = new Date();

    console.log(`\n✅ Fund token created: ${mintKeypair.publicKey.toBase58()}`);
    console.log(
      `   Mint Authority: ${this.fundAdministrator.publicKey.toBase58()}`
    );
    console.log(
      `   Freeze Authority: ${this.fundAdministrator.publicKey.toBase58()}`
    );
    console.log(`   Default State: FROZEN (requires whitelisting)`);
    console.log(`   ✨ Metadata: ON-CHAIN`);
    console.log(`   - NAV: $${config.initialNAV.toFixed(6)}`);
    console.log(`   - Schedule: ${config.strikeSchedule.join(", ")}`);
    console.log(
      `   🔗 Token: ${this.getAddressLink(mintKeypair.publicKey.toBase58())}`
    );
    console.log(`   🔗 Tx: ${this.getTxExplorerLink(signature)}`);

    return mintKeypair.publicKey;
  }

  /**
   * Updates NAV on-chain in token metadata
   */
  async updateNAV(
    fundMint: PublicKey,
    newNAV: number,
    fundComposition?: Record<string, number>
  ): Promise<string> {
    const previousNAV = this.currentNAV;
    this.currentNAV = newNAV;
    this.lastStrikeTime = new Date();

    const transaction = new Transaction();

    // Update NAV field
    transaction.add(
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: fundMint,
        updateAuthority: this.fundAdministrator.publicKey,
        field: "currentNAV",
        value: newNAV.toFixed(6),
      })
    );

    // Update last strike time
    transaction.add(
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: fundMint,
        updateAuthority: this.fundAdministrator.publicKey,
        field: "lastStrikeTime",
        value: this.lastStrikeTime.toISOString(),
      })
    );

    // Update AUM
    transaction.add(
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: fundMint,
        updateAuthority: this.fundAdministrator.publicKey,
        field: "totalAUM",
        value: this.totalAUM.toFixed(2),
      })
    );

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.fundAdministrator],
      { commitment: "confirmed" }
    );

    const navChange = ((newNAV - previousNAV) / previousNAV) * 100;
    const changeSymbol = navChange >= 0 ? "▲" : "▼";

    console.log(
      `   NAV Updated: $${previousNAV.toFixed(6)} → $${newNAV.toFixed(
        6
      )} (${changeSymbol}${Math.abs(navChange).toFixed(4)}%)`
    );
    console.log(`   🔗 Explorer: ${this.getTxExplorerLink(signature)}`);

    return signature;
  }

  /**
   * Whitelists an investor by creating their fund account and thawing it
   */
  async whitelistInvestor(
    fundMint: PublicKey,
    investor: PublicKey,
    payer: Keypair
  ): Promise<PublicKey> {
    console.log(
      `\n🔓 Whitelisting investor: ${investor.toBase58().slice(0, 20)}...`
    );

    // Get or create token account (will be frozen by default)
    const fundAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      payer,
      fundMint,
      investor,
      false,
      "confirmed",
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );

    console.log(`   Account: ${fundAccount.address.toBase58()}`);

    // Thaw the account if frozen
    if (fundAccount.isFrozen) {
      await thawAccount(
        this.connection,
        this.fundAdministrator,
        fundAccount.address,
        fundMint,
        this.fundAdministrator,
        [],
        { commitment: "confirmed" },
        TOKEN_2022_PROGRAM_ID
      );
      console.log(`✅ Investor whitelisted and account thawed`);
    } else {
      console.log(`✅ Investor already whitelisted`);
    }

    return fundAccount.address;
  }

  /**
   * Removes an investor from whitelist by freezing their account
   */
  async removeFromWhitelist(
    fundMint: PublicKey,
    investorFundAccount: PublicKey
  ): Promise<void> {
    console.log(
      `\n🔒 Removing from whitelist: ${investorFundAccount.toBase58()}`
    );

    await freezeAccount(
      this.connection,
      this.fundAdministrator,
      investorFundAccount,
      fundMint,
      this.fundAdministrator,
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );

    console.log(`✅ Account frozen and removed from whitelist`);
  }

  /**
   * Delegates USDC authority to fund administrator for subscription
   */
  async delegateUSDCForSubscription(
    investor: Keypair,
    usdcMint: PublicKey,
    amount: number
  ): Promise<void> {
    const investorUSDC = await getAssociatedTokenAddress(
      usdcMint,
      investor.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    console.log(`\n🤝 Delegating USDC for subscription...`);
    console.log(`   Amount: $${amount.toLocaleString()}`);

    await approve(
      this.connection,
      investor,
      investorUSDC,
      this.fundAdministrator.publicKey,
      investor.publicKey,
      amount * 1e6, // USDC has 6 decimals
      [],
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    console.log(`✅ USDC delegation approved`);
  }

  /**
   * Delegates fund shares authority to administrator for redemption
   */
  async delegateSharesForRedemption(
    investor: Keypair,
    fundMint: PublicKey,
    shareAmount: number
  ): Promise<void> {
    const investorShares = await getAssociatedTokenAddress(
      fundMint,
      investor.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    console.log(`\n🤝 Delegating shares for redemption...`);
    console.log(`   Shares: ${shareAmount.toLocaleString()}`);

    await approve(
      this.connection,
      investor,
      investorShares,
      this.fundAdministrator.publicKey,
      investor.publicKey,
      Math.floor(shareAmount * 1e6), // 6 decimals
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );

    console.log(`✅ Share delegation approved`);
  }

  /**
   * Executes atomic subscription: USDC → Fund Shares at current NAV
   */
  async processSubscription(
    params: SubscriptionParams
  ): Promise<SubscriptionResult> {
    const { fundMint, usdcMint, investor, usdcAmount } = params;

    // Calculate shares at current NAV
    const sharesToMint = usdcAmount / this.currentNAV;

    // Format investor display
    const shortAddr = `${investor.toBase58().slice(0, 4)}...${investor
      .toBase58()
      .slice(-4)}`;

    console.log(`\n⚡ Processing subscription...`);
    console.log(`   Investor: ${shortAddr}`);
    console.log(`   USDC Amount: $${usdcAmount.toLocaleString()}`);
    console.log(`   NAV: $${this.currentNAV.toFixed(6)}`);
    console.log(`   Shares to mint: ${sharesToMint.toFixed(6)}`);

    // Get token accounts
    const investorUSDC = await getAssociatedTokenAddress(
      usdcMint,
      investor,
      false,
      TOKEN_PROGRAM_ID
    );

    const fundUSDC = await getAssociatedTokenAddress(
      usdcMint,
      this.fundAdministrator.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    const investorShares = await getAssociatedTokenAddress(
      fundMint,
      investor,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // Build atomic transaction
    const transaction = new Transaction();

    // 1. Transfer USDC from investor to fund (using delegated authority)
    transaction.add(
      createTransferCheckedInstruction(
        investorUSDC,
        usdcMint,
        fundUSDC,
        this.fundAdministrator.publicKey, // delegate
        Math.floor(usdcAmount * 1e6),
        6,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    // 2. Mint fund shares to investor
    transaction.add(
      createMintToInstruction(
        fundMint,
        investorShares,
        this.fundAdministrator.publicKey,
        Math.floor(sharesToMint * 1e6),
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    // Send atomic transaction
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.fundAdministrator],
      { commitment: "confirmed" }
    );

    // Update fund state
    this.totalAUM += usdcAmount;
    this.totalSharesOutstanding += sharesToMint;

    console.log(`✅ SUBSCRIPTION SETTLED ATOMICALLY`);
    console.log(`   Shares issued: ${sharesToMint.toFixed(6)}`);
    console.log(`   New AUM: $${this.totalAUM.toLocaleString()}`);
    console.log(`   🔗 Explorer: ${this.getTxExplorerLink(signature)}`);

    return {
      signature,
      usdcAmount,
      sharesIssued: sharesToMint,
      executionNAV: this.currentNAV,
      timestamp: new Date(),
    };
  }

  /**
   * Executes atomic redemption: Fund Shares → USDC at current NAV
   */
  async processRedemption(params: RedemptionParams): Promise<RedemptionResult> {
    const { fundMint, usdcMint, investor, shareAmount } = params;

    // Calculate USDC at current NAV
    const usdcToPay = shareAmount * this.currentNAV;

    // Format investor display
    const shortAddr = `${investor.toBase58().slice(0, 4)}...${investor
      .toBase58()
      .slice(-4)}`;

    console.log(`\n⚡ Processing redemption...`);
    console.log(`   Investor: ${shortAddr}`);
    console.log(`   Shares to redeem: ${shareAmount.toLocaleString()}`);
    console.log(`   NAV: $${this.currentNAV.toFixed(6)}`);
    console.log(`   USDC to pay: $${usdcToPay.toFixed(2)}`);

    // Get token accounts
    const investorShares = await getAssociatedTokenAddress(
      fundMint,
      investor,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const investorUSDC = await getAssociatedTokenAddress(
      usdcMint,
      investor,
      false,
      TOKEN_PROGRAM_ID
    );

    const fundUSDC = await getAssociatedTokenAddress(
      usdcMint,
      this.fundAdministrator.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    // Build atomic transaction
    const transaction = new Transaction();

    // 1. Burn fund shares from investor (using delegated authority)
    transaction.add(
      createBurnInstruction(
        investorShares,
        fundMint,
        this.fundAdministrator.publicKey, // delegate
        Math.floor(shareAmount * 1e6),
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    // 2. Transfer USDC from fund to investor
    transaction.add(
      createTransferCheckedInstruction(
        fundUSDC,
        usdcMint,
        investorUSDC,
        this.fundAdministrator.publicKey,
        Math.floor(usdcToPay * 1e6),
        6,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    // Send atomic transaction
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.fundAdministrator],
      { commitment: "confirmed" }
    );

    // Update fund state
    this.totalAUM -= usdcToPay;
    this.totalSharesOutstanding -= shareAmount;

    console.log(`✅ REDEMPTION SETTLED ATOMICALLY`);
    console.log(`   USDC paid: $${usdcToPay.toFixed(2)}`);
    console.log(`   New AUM: $${this.totalAUM.toLocaleString()}`);
    console.log(`   🔗 Explorer: ${this.getTxExplorerLink(signature)}`);

    return {
      signature,
      sharesRedeemed: shareAmount,
      usdcPaid: usdcToPay,
      executionNAV: this.currentNAV,
      timestamp: new Date(),
    };
  }

  /**
   * Queue an order for the next NAV strike
   */
  queueOrder(
    investor: PublicKey,
    orderType: "subscribe" | "redeem",
    amount: number
  ): StrikeOrder {
    const order: StrikeOrder = {
      orderId: `ORD-${++this.orderCounter}`,
      investor,
      orderType,
      amount,
      strikeTime: this.getNextStrikeTime(),
      status: "pending",
    };

    this.pendingOrders.push(order);

    // Format investor display
    const shortAddr = `${investor.toBase58().slice(0, 4)}...${investor
      .toBase58()
      .slice(-4)}`;

    console.log(`\n📝 Order queued: ${order.orderId}`);
    console.log(`   Investor: ${shortAddr}`);
    console.log(`   Type: ${orderType}`);
    console.log(
      `   Amount: ${
        orderType === "subscribe"
          ? `$${amount.toLocaleString()} USDC`
          : `${amount.toLocaleString()} shares`
      }`
    );

    return order;
  }

  /**
   * Execute NAV strike - update NAV and process all pending orders
   *
   * Note: Investors must have delegated authority to the fund administrator
   * before the strike via delegateUSDCForSubscription() or delegateSharesForRedemption()
   */
  async executeStrike(
    fundMint: PublicKey,
    usdcMint: PublicKey,
    newNAV: number
  ): Promise<StrikeResult> {
    const strikeId = `STRIKE-${Date.now()}`;
    const strikeTime = new Date();

    console.log(
      "\n╔══════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║                    NAV STRIKE EXECUTION                       ║"
    );
    console.log(
      "╚══════════════════════════════════════════════════════════════╝"
    );
    console.log(`   Strike ID: ${strikeId}`);
    console.log(`   Strike Time: ${strikeTime.toISOString()}`);
    console.log(`   New NAV: $${newNAV.toFixed(6)}`);
    console.log(`   Pending Orders: ${this.pendingOrders.length}`);
    console.log(
      "────────────────────────────────────────────────────────────────"
    );

    // 1. Update NAV
    await this.updateNAV(fundMint, newNAV);

    // 2. Process pending orders
    const signatures: string[] = [];
    let totalUSDCSubscribed = 0;
    let totalSharesMinted = 0;
    let totalSharesRedeemed = 0;
    let totalUSDCPaid = 0;
    let subscriptionsProcessed = 0;
    let redemptionsProcessed = 0;

    const subscriptions = this.pendingOrders.filter(
      (o) => o.orderType === "subscribe" && o.status === "pending"
    );

    const redemptions = this.pendingOrders.filter(
      (o) => o.orderType === "redeem" && o.status === "pending"
    );

    // Process subscriptions
    console.log(`\n📥 Processing ${subscriptions.length} subscriptions...`);
    for (const order of subscriptions) {
      try {
        const result = await this.processSubscription({
          fundMint,
          usdcMint,
          investor: order.investor,
          usdcAmount: order.amount,
        });

        order.status = "executed";
        signatures.push(result.signature);
        totalUSDCSubscribed += result.usdcAmount;
        totalSharesMinted += result.sharesIssued;
        subscriptionsProcessed++;
      } catch (error) {
        console.error(`   ❌ Order ${order.orderId} failed:`, error);
        order.status = "failed";
      }
    }

    // Process redemptions
    console.log(`\n📤 Processing ${redemptions.length} redemptions...`);
    for (const order of redemptions) {
      try {
        const result = await this.processRedemption({
          fundMint,
          usdcMint,
          investor: order.investor,
          shareAmount: order.amount,
        });

        order.status = "executed";
        signatures.push(result.signature);
        totalSharesRedeemed += result.sharesRedeemed;
        totalUSDCPaid += result.usdcPaid;
        redemptionsProcessed++;
      } catch (error) {
        console.error(`   ❌ Order ${order.orderId} failed:`, error);
        order.status = "failed";
      }
    }

    // Clear executed orders
    this.pendingOrders = this.pendingOrders.filter(
      (o) => o.status === "pending"
    );

    // Print summary
    console.log(
      "\n════════════════════════════════════════════════════════════════"
    );
    console.log(
      "                       STRIKE SUMMARY                            "
    );
    console.log(
      "════════════════════════════════════════════════════════════════"
    );
    console.log(`   Subscriptions: ${subscriptionsProcessed} processed`);
    console.log(`   Total USDC In: $${totalUSDCSubscribed.toLocaleString()}`);
    console.log(`   Shares Minted: ${totalSharesMinted.toFixed(2)}`);
    console.log(`   Redemptions: ${redemptionsProcessed} processed`);
    console.log(`   Shares Burned: ${totalSharesRedeemed.toFixed(2)}`);
    console.log(`   Total USDC Out: $${totalUSDCPaid.toLocaleString()}`);
    console.log(`   New AUM: $${this.totalAUM.toLocaleString()}`);
    console.log(
      `   Shares Outstanding: ${this.totalSharesOutstanding.toFixed(2)}`
    );
    console.log(
      "════════════════════════════════════════════════════════════════\n"
    );

    return {
      strikeId,
      strikeTime,
      nav: this.currentNAV,
      subscriptionsProcessed,
      totalUSDCSubscribed,
      totalSharesMinted,
      redemptionsProcessed,
      totalSharesRedeemed,
      totalUSDCPaid,
      signatures,
    };
  }

  /**
   * Get current fund state
   */
  getFundState(fundMint: PublicKey): FundState {
    return {
      fundMint,
      currentNAV: this.currentNAV,
      lastStrikeTime: this.lastStrikeTime,
      totalAUM: this.totalAUM,
      totalSharesOutstanding: this.totalSharesOutstanding,
    };
  }

  /**
   * Get current NAV
   */
  getCurrentNAV(): number {
    return this.currentNAV;
  }

  /**
   * Get pending orders
   */
  getPendingOrders(): StrikeOrder[] {
    return [...this.pendingOrders];
  }

  /**
   * Calculate next strike time based on schedule
   */
  getNextStrikeTime(): Date {
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;

    for (const strikeTime of this.strikeSchedule) {
      if (strikeTime > currentTime) {
        const [hours, minutes] = strikeTime.split(":");
        const strikeDate = new Date(now);
        strikeDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        return strikeDate;
      }
    }

    // Next strike is tomorrow's first strike
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const [hours, minutes] = this.strikeSchedule[0].split(":");
    tomorrow.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    return tomorrow;
  }

  /**
   * Get account info for inspection
   */
  async getAccountInfo(tokenAccount: PublicKey, programId: PublicKey) {
    const account = await getAccount(
      this.connection,
      tokenAccount,
      "confirmed",
      programId
    );

    return {
      address: tokenAccount,
      mint: account.mint,
      owner: account.owner,
      amount: Number(account.amount),
      isFrozen: account.isFrozen,
    };
  }

  /**
   * Airdrops SOL for testing
   */
  async airdropSol(publicKey: PublicKey, amount: number): Promise<void> {
    console.log(
      `\n💰 Airdropping ${amount} SOL to ${publicKey
        .toBase58()
        .slice(0, 20)}...`
    );
    const signature = await this.connection.requestAirdrop(
      publicKey,
      amount * LAMPORTS_PER_SOL
    );
    await this.connection.confirmTransaction(signature, "confirmed");
    console.log(`✅ Airdrop complete`);
  }
}
