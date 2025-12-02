/**
 * NAV Strikes Engine - Solana Kit Reference Implementation
 *
 * This implementation demonstrates NAV strikes for money market funds on Solana using:
 * - SPL Token 2022 with Default Account State extension for fund shares
 * - Standard USDC for settlement
 * - Atomic transactions for subscription/redemption
 * - Delegated authority pattern for fund administrator
 *
 * Built with @solana/kit (web3.js 2.0)
 *
 * ⚠️ IMPORTANT: This is a reference implementation for educational purposes.
 * Do NOT use in production without proper audits and security reviews.
 */

import {
  Address,
  address,
  airdropFactory,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  KeyPairSigner,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  TransactionSigner,
  Rpc,
  RpcSubscriptions,
  SolanaRpcApi,
  SolanaRpcSubscriptionsApi,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getMintSize,
  TOKEN_PROGRAM_ADDRESS,
  getApproveInstruction,
  getTransferCheckedInstruction,
  getMintToInstruction,
  getBurnInstruction,
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstruction,
  fetchToken,
  fetchMaybeToken,
} from "@solana-program/token";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  getInitializeMintInstruction as getInitializeMint2022Instruction,
  getInitializeTokenMetadataInstruction,
  getUpdateTokenMetadataFieldInstruction,
  tokenMetadataField,
  getThawAccountInstruction,
  getFreezeAccountInstruction,
  AccountState,
  fetchMint as fetchMint2022,
  getMintSize as getMintSize2022,
  extension,
  getPreInitializeInstructionsForMintExtensions,
  fetchMaybeToken as fetchMaybeToken2022,
} from "@solana-program/token-2022";

import type {
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
    return `${baseUrl}/${signature}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`;
  }
  return `${baseUrl}/${signature}?cluster=${cluster}`;
}

/**
 * Generate Solana Explorer link for an account/address
 */
export function getAddressExplorerLink(
  addr: string,
  cluster: ClusterType = "localnet"
): string {
  const baseUrl = "https://explorer.solana.com/address";
  if (cluster === "localnet") {
    return `${baseUrl}/${addr}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`;
  }
  return `${baseUrl}/${addr}?cluster=${cluster}`;
}

/**
 * Create a Solana client for Kit
 */
export async function createSolanaClient(
  rpcUrl: string = "http://127.0.0.1:8899",
  wsUrl: string = "ws://127.0.0.1:8900"
): Promise<SolanaClient> {
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  return {
    rpc,
    rpcSubscriptions,
    sendAndConfirmTransaction,
  };
}

/**
 * NAV Strike Engine - Solana Kit Version
 *
 * Manages the lifecycle of a money market fund on Solana:
 * - Creates fund tokens with Token 2022 extensions
 * - Updates NAV at scheduled strike times
 * - Processes subscription and redemption orders atomically
 */
export class NAVStrikeEngine {
  private client: SolanaClient;
  private fundAdministrator: KeyPairSigner;
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
    client: SolanaClient,
    fundAdministrator: KeyPairSigner,
    cluster: ClusterType = "localnet"
  ) {
    this.client = client;
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
  getAddressLink(addr: string): string {
    return getAddressExplorerLink(addr, this.cluster);
  }

  /**
   * Creates a fund share token using Token-2022 with Default Account State and Metadata extensions
   * Fund shares are frozen by default and require whitelisting
   * Metadata stores NAV and fund information on-chain
   */
  async createFundToken(
    issuer: KeyPairSigner,
    config: FundTokenConfig
  ): Promise<Address> {
    console.log(
      "\n╔══════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║              NAV STRIKE - FUND CREATION (Kit)                 ║"
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
    const mint = await generateKeyPairSigner();
    const decimals = config.decimals ?? 6;

    // Define extensions
    const defaultAccountStateExtension = extension("DefaultAccountState", {
      state: AccountState.Frozen,
    });
    const metadataPointerExtension = extension("MetadataPointer", {
      authority: this.fundAdministrator.address,
      metadataAddress: mint.address,
    });
    const extensions = [defaultAccountStateExtension, metadataPointerExtension];

    // Calculate mint size without metadata
    const baseMintSize = getMintSize2022(extensions);

    // Calculate extra space for metadata (name, symbol, uri, and custom fields)
    // We need to estimate metadata size for rent calculation
    // Format: TLV header (4 bytes) + metadata struct
    const metadataEstimate =
      4 + // TLV header
      4 +
      config.name.length + // name
      4 +
      config.symbol.length + // symbol
      4 +
      (config.description?.length ?? 0) + // uri
      // Additional metadata fields (key-value pairs with max sizes)
      4 +
      "currentNAV".length +
      4 +
      "999999.999999".length +
      4 +
      "lastStrikeTime".length +
      4 +
      "2099-12-31T23:59:59.999Z".length +
      4 +
      "strikeSchedule".length +
      4 +
      JSON.stringify(config.strikeSchedule).length +
      4 +
      "totalAUM".length +
      4 +
      "999999999999999.99".length +
      4 +
      "fundType".length +
      4 +
      "Money Market Fund".length +
      500; // Extra buffer for safety

    const totalSpace = baseMintSize + metadataEstimate;

    // Get rent for total space
    const mintRent = await this.client.rpc
      .getMinimumBalanceForRentExemption(BigInt(totalSpace))
      .send();

    // Build create account instruction (with base size, but extra rent for metadata)
    const createAccountIx = getCreateAccountInstruction({
      payer: issuer,
      newAccount: mint,
      lamports: lamports(mintRent),
      space: baseMintSize,
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    });

    // Get extension initialization instructions
    const preInitIxs = getPreInitializeInstructionsForMintExtensions(
      mint.address,
      extensions
    );

    // Initialize mint instruction (Token 2022)
    const initMintIx = getInitializeMint2022Instruction({
      mint: mint.address,
      decimals,
      mintAuthority: this.fundAdministrator.address,
      freezeAuthority: this.fundAdministrator.address,
    });

    // Initialize metadata instruction
    const initMetadataIx = getInitializeTokenMetadataInstruction({
      metadata: mint.address,
      updateAuthority: this.fundAdministrator.address,
      mint: mint.address,
      mintAuthority: this.fundAdministrator,
      name: config.name,
      symbol: config.symbol,
      uri: "Link to image",
    });

    // Build custom metadata field update instructions
    const initialMetadata: [string, string][] = [
      ["img-uri", "Link to image"],
      ["currentNAV", config.initialNAV.toFixed(6)],
      ["lastStrikeTime", new Date().toISOString()],
      ["strikeSchedule", JSON.stringify(config.strikeSchedule)],
      ["totalAUM", "0.00"],
      ["fundType", "Money Market Fund"],
    ];

    const updateFieldIxs = initialMetadata.map(([key, value]) =>
      getUpdateTokenMetadataFieldInstruction({
        metadata: mint.address,
        updateAuthority: this.fundAdministrator,
        field: tokenMetadataField("Key", [key]),
        value,
      })
    );

    // Get latest blockhash
    const { value: latestBlockhash } = await this.client.rpc
      .getLatestBlockhash()
      .send();

    // Build transaction message
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(issuer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) =>
        appendTransactionMessageInstructions(
          [
            createAccountIx,
            ...preInitIxs,
            initMintIx,
            initMetadataIx,
            ...updateFieldIxs,
          ],
          tx
        )
    );

    // Sign and send
    const signedTransaction = await signTransactionMessageWithSigners(
      transactionMessage
    );
    const signature = getSignatureFromTransaction(signedTransaction);

    await this.client.sendAndConfirmTransaction(signedTransaction, {
      commitment: "confirmed",
    });

    // Update internal state
    this.currentNAV = config.initialNAV;
    this.strikeSchedule = config.strikeSchedule;
    this.lastStrikeTime = new Date();

    console.log(`\n✅ Fund token created: ${mint.address}`);
    console.log(`   Mint Authority: ${this.fundAdministrator.address}`);
    console.log(`   Freeze Authority: ${this.fundAdministrator.address}`);
    console.log(`   Default State: FROZEN (requires whitelisting)`);
    console.log(`   ✨ Metadata: ON-CHAIN`);
    console.log(`   - NAV: $${config.initialNAV.toFixed(6)}`);
    console.log(`   - Schedule: ${config.strikeSchedule.join(", ")}`);
    console.log(`   🔗 Token: ${this.getAddressLink(mint.address)}`);
    console.log(`   🔗 Tx: ${this.getTxExplorerLink(signature)}`);

    return mint.address;
  }

  /**
   * Updates NAV on-chain in token metadata
   */
  async updateNAV(fundMint: Address, newNAV: number): Promise<string> {
    const previousNAV = this.currentNAV;
    this.currentNAV = newNAV;
    this.lastStrikeTime = new Date();

    // Build update field instructions
    const updateNavIx = getUpdateTokenMetadataFieldInstruction({
      metadata: fundMint,
      updateAuthority: this.fundAdministrator,
      field: tokenMetadataField("Key", ["currentNAV"]),
      value: newNAV.toFixed(6),
    });

    const updateTimeIx = getUpdateTokenMetadataFieldInstruction({
      metadata: fundMint,
      updateAuthority: this.fundAdministrator,
      field: tokenMetadataField("Key", ["lastStrikeTime"]),
      value: this.lastStrikeTime.toISOString(),
    });

    const updateAumIx = getUpdateTokenMetadataFieldInstruction({
      metadata: fundMint,
      updateAuthority: this.fundAdministrator,
      field: tokenMetadataField("Key", ["totalAUM"]),
      value: this.totalAUM.toFixed(2),
    });

    const { value: latestBlockhash } = await this.client.rpc
      .getLatestBlockhash()
      .send();

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(this.fundAdministrator, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) =>
        appendTransactionMessageInstructions(
          [updateNavIx, updateTimeIx, updateAumIx],
          tx
        )
    );

    const signedTransaction = await signTransactionMessageWithSigners(
      transactionMessage
    );
    const signature = getSignatureFromTransaction(signedTransaction);

    await this.client.sendAndConfirmTransaction(signedTransaction, {
      commitment: "confirmed",
    });

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
    fundMint: Address,
    investor: Address,
    payer: KeyPairSigner
  ): Promise<Address> {
    console.log(`\n🔓 Whitelisting investor: ${investor.slice(0, 20)}...`);

    // Find the ATA
    const [ata] = await findAssociatedTokenPda({
      mint: fundMint,
      owner: investor,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    const maybeToken = await fetchMaybeToken2022(this.client.rpc, ata, {
      commitment: "confirmed",
    });

    const { value: latestBlockhash } = await this.client.rpc
      .getLatestBlockhash()
      .send();

    if (!maybeToken.exists) {
      // Create ATA
      const createAtaIx = getCreateAssociatedTokenInstruction({
        payer,
        owner: investor,
        mint: fundMint,
        ata,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });

      const createAtaMsg = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(payer, tx),
        (tx) =>
          setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) => appendTransactionMessageInstructions([createAtaIx], tx)
      );

      const signedCreateAta = await signTransactionMessageWithSigners(
        createAtaMsg
      );
      await this.client.sendAndConfirmTransaction(signedCreateAta, {
        commitment: "confirmed",
      });
    }

    // Thaw the account
    const thawIx = getThawAccountInstruction({
      account: ata,
      mint: fundMint,
      owner: this.fundAdministrator,
    });

    const thawMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([thawIx], tx)
    );

    const signedThaw = await signTransactionMessageWithSigners(thawMsg);
    await this.client.sendAndConfirmTransaction(signedThaw, {
      commitment: "confirmed",
    });

    console.log(`   Account: ${ata}`);
    console.log(`✅ Investor whitelisted and account thawed`);

    return ata;
  }

  /**
   * Removes an investor from whitelist by freezing their account
   */
  async removeFromWhitelist(
    fundMint: Address,
    investorFundAccount: Address,
    payer: KeyPairSigner
  ): Promise<void> {
    console.log(`\n🔒 Removing from whitelist: ${investorFundAccount}`);

    const { value: latestBlockhash } = await this.client.rpc
      .getLatestBlockhash()
      .send();

    const freezeIx = getFreezeAccountInstruction({
      account: investorFundAccount,
      mint: fundMint,
      owner: this.fundAdministrator,
    });

    const freezeMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([freezeIx], tx)
    );

    const signedFreeze = await signTransactionMessageWithSigners(freezeMsg);
    await this.client.sendAndConfirmTransaction(signedFreeze, {
      commitment: "confirmed",
    });

    console.log(`✅ Account frozen and removed from whitelist`);
  }

  /**
   * Delegates USDC authority to fund administrator for subscription
   */
  async delegateUSDCForSubscription(
    investor: KeyPairSigner,
    usdcMint: Address,
    amount: number
  ): Promise<void> {
    const [investorUSDC] = await findAssociatedTokenPda({
      mint: usdcMint,
      owner: investor.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    console.log(`\n🤝 Delegating USDC for subscription...`);
    console.log(`   Amount: $${amount.toLocaleString()}`);

    const { value: latestBlockhash } = await this.client.rpc
      .getLatestBlockhash()
      .send();

    const approveIx = getApproveInstruction({
      source: investorUSDC,
      delegate: this.fundAdministrator.address,
      owner: investor,
      amount: BigInt(amount * 1e6),
    });

    const approveMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(investor, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([approveIx], tx)
    );

    const signedApprove = await signTransactionMessageWithSigners(approveMsg);
    await this.client.sendAndConfirmTransaction(signedApprove, {
      commitment: "confirmed",
    });

    console.log(`✅ USDC delegation approved`);
  }

  /**
   * Delegates fund shares authority to administrator for redemption
   */
  async delegateSharesForRedemption(
    investor: KeyPairSigner,
    fundMint: Address,
    shareAmount: number
  ): Promise<void> {
    const [investorShares] = await findAssociatedTokenPda({
      mint: fundMint,
      owner: investor.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    console.log(`\n🤝 Delegating shares for redemption...`);
    console.log(`   Shares: ${shareAmount.toLocaleString()}`);

    const { value: latestBlockhash } = await this.client.rpc
      .getLatestBlockhash()
      .send();

    const approveIx = getApproveInstruction(
      {
        source: investorShares,
        delegate: this.fundAdministrator.address,
        owner: investor,
        amount: BigInt(Math.floor(shareAmount * 1e6)),
      },
      { programAddress: TOKEN_2022_PROGRAM_ADDRESS }
    );

    const approveMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(investor, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([approveIx], tx)
    );

    const signedApprove = await signTransactionMessageWithSigners(approveMsg);
    await this.client.sendAndConfirmTransaction(signedApprove, {
      commitment: "confirmed",
    });

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
    const shortAddr = `${investor.slice(0, 4)}...${investor.slice(-4)}`;

    console.log(`\n⚡ Processing subscription...`);
    console.log(`   Investor: ${shortAddr}`);
    console.log(`   USDC Amount: $${usdcAmount.toLocaleString()}`);
    console.log(`   NAV: $${this.currentNAV.toFixed(6)}`);
    console.log(`   Shares to mint: ${sharesToMint.toFixed(6)}`);

    // Get token accounts
    const [investorUSDC] = await findAssociatedTokenPda({
      mint: usdcMint,
      owner: investor,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const [fundUSDC] = await findAssociatedTokenPda({
      mint: usdcMint,
      owner: this.fundAdministrator.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const [investorShares] = await findAssociatedTokenPda({
      mint: fundMint,
      owner: investor,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    const { value: latestBlockhash } = await this.client.rpc
      .getLatestBlockhash()
      .send();

    // Build atomic transaction with both instructions
    // 1. Transfer USDC from investor to fund (using delegated authority)
    const transferUSDCIx = getTransferCheckedInstruction({
      source: investorUSDC,
      mint: usdcMint,
      destination: fundUSDC,
      authority: this.fundAdministrator,
      amount: BigInt(Math.floor(usdcAmount * 1e6)),
      decimals: 6,
    });

    // 2. Mint fund shares to investor
    const mintSharesIx = getMintToInstruction(
      {
        mint: fundMint,
        token: investorShares,
        mintAuthority: this.fundAdministrator,
        amount: BigInt(Math.floor(sharesToMint * 1e6)),
      },
      { programAddress: TOKEN_2022_PROGRAM_ADDRESS }
    );

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(this.fundAdministrator, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) =>
        appendTransactionMessageInstructions([transferUSDCIx, mintSharesIx], tx)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const signature = getSignatureFromTransaction(signedTx);

    await this.client.sendAndConfirmTransaction(signedTx, {
      commitment: "confirmed",
    });

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
    const shortAddr = `${investor.slice(0, 4)}...${investor.slice(-4)}`;

    console.log(`\n⚡ Processing redemption...`);
    console.log(`   Investor: ${shortAddr}`);
    console.log(`   Shares to redeem: ${shareAmount.toLocaleString()}`);
    console.log(`   NAV: $${this.currentNAV.toFixed(6)}`);
    console.log(`   USDC to pay: $${usdcToPay.toFixed(2)}`);

    // Get token accounts
    const [investorShares] = await findAssociatedTokenPda({
      mint: fundMint,
      owner: investor,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    const [investorUSDC] = await findAssociatedTokenPda({
      mint: usdcMint,
      owner: investor,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const [fundUSDC] = await findAssociatedTokenPda({
      mint: usdcMint,
      owner: this.fundAdministrator.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const { value: latestBlockhash } = await this.client.rpc
      .getLatestBlockhash()
      .send();

    // Build atomic transaction with both instructions
    // 1. Burn fund shares from investor (using delegated authority)
    const burnSharesIx = getBurnInstruction(
      {
        account: investorShares,
        mint: fundMint,
        authority: this.fundAdministrator,
        amount: BigInt(Math.floor(shareAmount * 1e6)),
      },
      { programAddress: TOKEN_2022_PROGRAM_ADDRESS }
    );

    // 2. Transfer USDC from fund to investor
    const transferUSDCIx = getTransferCheckedInstruction({
      source: fundUSDC,
      mint: usdcMint,
      destination: investorUSDC,
      authority: this.fundAdministrator,
      amount: BigInt(Math.floor(usdcToPay * 1e6)),
      decimals: 6,
    });

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(this.fundAdministrator, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) =>
        appendTransactionMessageInstructions([burnSharesIx, transferUSDCIx], tx)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const signature = getSignatureFromTransaction(signedTx);

    await this.client.sendAndConfirmTransaction(signedTx, {
      commitment: "confirmed",
    });

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
    investor: Address,
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

    const shortAddr = `${investor.slice(0, 4)}...${investor.slice(-4)}`;

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
   */
  async executeStrike(
    fundMint: Address,
    usdcMint: Address,
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
  getFundState(fundMint: Address): FundState {
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
   * Airdrops SOL for testing
   */
  async airdropSol(publicKey: Address, amount: number): Promise<void> {
    console.log(
      `\n💰 Airdropping ${amount} SOL to ${publicKey.slice(0, 20)}...`
    );
    const airdrop = airdropFactory({
      rpc: this.client.rpc,
      rpcSubscriptions: this.client.rpcSubscriptions,
    });
    await airdrop({
      recipientAddress: publicKey,
      lamports: lamports(BigInt(amount * 1_000_000_000)),
      commitment: "confirmed",
    });
    console.log(`✅ Airdrop complete`);
  }
}
