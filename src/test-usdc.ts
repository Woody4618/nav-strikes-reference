/**
 * Test USDC Utility
 *
 * Creates a mock USDC token for testing on local validator or devnet.
 * This simulates USDC with 6 decimals.
 *
 * ⚠️ FOR TESTING ONLY - Not real USDC
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createInitializeMintInstruction,
  createMintToInstruction,
  getOrCreateAssociatedTokenAccount,
  getMintLen,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

/**
 * Creates a mock USDC token for testing
 * Returns the mint public key
 */
export async function createTestUSDC(
  connection: Connection,
  payer: Keypair,
  mintAuthority: Keypair
): Promise<PublicKey> {
  console.log("\n💵 Creating test USDC token...");

  const mintKeypair = Keypair.generate();
  const decimals = 6; // USDC has 6 decimals

  const space = getMintLen([]);
  const lamports = await connection.getMinimumBalanceForRentExemption(space);

  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      decimals,
      mintAuthority.publicKey,
      null, // no freeze authority
      TOKEN_PROGRAM_ID
    )
  );

  await sendAndConfirmTransaction(connection, transaction, [payer, mintKeypair], {
    commitment: "confirmed",
  });

  console.log(`✅ Test USDC created: ${mintKeypair.publicKey.toBase58()}`);
  return mintKeypair.publicKey;
}

/**
 * Mints test USDC to a recipient
 */
export async function mintTestUSDC(
  connection: Connection,
  usdcMint: PublicKey,
  mintAuthority: Keypair,
  recipient: PublicKey,
  amount: number,
  recipientName?: string
): Promise<PublicKey> {
  const shortAddr = `${recipient.toBase58().slice(0, 4)}...${recipient.toBase58().slice(-4)}`;
  const displayName = recipientName ? `"${recipientName}" (${shortAddr})` : shortAddr;
  console.log(`\n💵 Minting $${amount.toLocaleString()} test USDC to ${displayName}`);

  // Get or create recipient's USDC account
  const recipientAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    usdcMint,
    recipient,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );

  // Mint USDC
  const transaction = new Transaction().add(
    createMintToInstruction(
      usdcMint,
      recipientAccount.address,
      mintAuthority.publicKey,
      amount * 1e6, // 6 decimals
      [],
      TOKEN_PROGRAM_ID
    )
  );

  await sendAndConfirmTransaction(connection, transaction, [mintAuthority], {
    commitment: "confirmed",
  });

  console.log(`✅ Minted $${amount.toLocaleString()} USDC`);

  return recipientAccount.address;
}

/**
 * Gets USDC balance for an account
 */
export async function getUSDCBalance(
  connection: Connection,
  usdcMint: PublicKey,
  owner: PublicKey
): Promise<number> {
  const { getAssociatedTokenAddress, getAccount } = await import("@solana/spl-token");

  try {
    const tokenAddress = await getAssociatedTokenAddress(
      usdcMint,
      owner,
      false,
      TOKEN_PROGRAM_ID
    );

    const account = await getAccount(connection, tokenAddress, "confirmed", TOKEN_PROGRAM_ID);
    return Number(account.amount) / 1e6;
  } catch {
    return 0;
  }
}

