/**
 * Test USDC Utility - Solana Kit Version
 *
 * Creates a mock USDC token for testing on local validator or devnet.
 * This simulates USDC with 6 decimals.
 *
 * Built with @solana/kit (web3.js 2.0)
 *
 * ⚠️ FOR TESTING ONLY - Not real USDC
 */

import {
  Address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  KeyPairSigner,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getInitializeMintInstruction,
  getMintSize,
  TOKEN_PROGRAM_ADDRESS,
  getMintToInstruction,
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstruction,
  fetchMaybeToken,
  fetchToken,
} from "@solana-program/token";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  fetchToken as fetchToken2022,
} from "@solana-program/token-2022";
import type { SolanaClient } from "./types";

/**
 * Helper to send and confirm transactions with correct typing
 * Works around stricter types in @solana/kit v5+
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendTransaction(
  client: SolanaClient,
  signedTx: any
): Promise<void> {
  await client.sendAndConfirmTransaction(signedTx, { commitment: "confirmed" });
}

/**
 * Creates a mock USDC token for testing
 * Returns the mint address
 */
export async function createTestUSDC(
  client: SolanaClient,
  payer: KeyPairSigner,
  mintAuthority: KeyPairSigner
): Promise<Address> {
  console.log("\n💵 Creating test USDC token...");

  const mint = await generateKeyPairSigner();
  const decimals = 6; // USDC has 6 decimals

  const mintSize = getMintSize();
  const mintRent = await client.rpc
    .getMinimumBalanceForRentExemption(BigInt(mintSize))
    .send();
  const { value: latestBlockhash } = await client.rpc
    .getLatestBlockhash()
    .send();

  // Create account instruction
  const createAccountIx = getCreateAccountInstruction({
    payer,
    newAccount: mint,
    lamports: lamports(mintRent),
    space: mintSize,
    programAddress: TOKEN_PROGRAM_ADDRESS,
  });

  // Initialize mint instruction
  const initMintIx = getInitializeMintInstruction({
    mint: mint.address,
    decimals,
    mintAuthority: mintAuthority.address,
    freezeAuthority: null,
  });

  // Build and send transaction
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) =>
      appendTransactionMessageInstructions([createAccountIx, initMintIx], tx)
  );

  const signedTransaction = await signTransactionMessageWithSigners(
    transactionMessage
  );
  await sendTransaction(client, signedTransaction);

  console.log(`✅ Test USDC created: ${mint.address}`);
  return mint.address;
}

/**
 * Mints test USDC to a recipient
 */
export async function mintTestUSDC(
  client: SolanaClient,
  usdcMint: Address,
  mintAuthority: KeyPairSigner,
  recipient: Address,
  amount: number,
  recipientName?: string
): Promise<Address> {
  const shortAddr = `${recipient.slice(0, 4)}...${recipient.slice(-4)}`;
  const displayName = recipientName
    ? `"${recipientName}" (${shortAddr})`
    : shortAddr;
  console.log(
    `\n💵 Minting $${amount.toLocaleString()} test USDC to ${displayName}`
  );

  // Find the ATA
  const [ata] = await findAssociatedTokenPda({
    mint: usdcMint,
    owner: recipient,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const { value: latestBlockhash } = await client.rpc
    .getLatestBlockhash()
    .send();

  // Check if account exists
  const maybeToken = await fetchMaybeToken(client.rpc, ata, {
    commitment: "confirmed",
  });

  if (!maybeToken.exists) {
    // Create ATA first
    const createAtaIx = getCreateAssociatedTokenInstruction({
      payer: mintAuthority,
      owner: recipient,
      mint: usdcMint,
      ata,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const createAtaMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(mintAuthority, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([createAtaIx], tx)
    );

    const signedCreateAta = await signTransactionMessageWithSigners(
      createAtaMsg
    );
    await sendTransaction(client, signedCreateAta);
  }

  // Mint USDC
  const mintToIx = getMintToInstruction({
    mint: usdcMint,
    token: ata,
    mintAuthority,
    amount: BigInt(amount * 1e6),
  });

  const { value: latestBlockhash2 } = await client.rpc
    .getLatestBlockhash()
    .send();

  const mintMsg = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(mintAuthority, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash2, tx),
    (tx) => appendTransactionMessageInstructions([mintToIx], tx)
  );

  const signedMint = await signTransactionMessageWithSigners(mintMsg);
  await sendTransaction(client, signedMint);

  console.log(`✅ Minted $${amount.toLocaleString()} USDC`);

  return ata;
}

/**
 * Gets USDC balance for an account
 */
export async function getUSDCBalance(
  client: SolanaClient,
  usdcMint: Address,
  owner: Address
): Promise<number> {
  try {
    const [tokenAddress] = await findAssociatedTokenPda({
      mint: usdcMint,
      owner,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const account = await fetchToken(client.rpc, tokenAddress, {
      commitment: "confirmed",
    });
    return Number(account.data.amount) / 1e6;
  } catch {
    return 0;
  }
}

/**
 * Gets fund share balance for an account
 */
export async function getFundShareBalance(
  client: SolanaClient,
  fundMint: Address,
  owner: Address
): Promise<number> {
  try {
    const [tokenAddress] = await findAssociatedTokenPda({
      mint: fundMint,
      owner,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    const account = await fetchToken2022(client.rpc, tokenAddress, {
      commitment: "confirmed",
    });
    return Number(account.data.amount) / 1e6;
  } catch {
    return 0;
  }
}
