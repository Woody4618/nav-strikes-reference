# NAV Strikes Reference Implementation for Solana

> ⚠️ **IMPORTANT: Educational Reference Implementation**
>
> This is a reference implementation for exploration and educational purposes only. **DO NOT** use this code directly in production without comprehensive security audits, proper key management, regulatory compliance review, and extensive modifications.

## What is NAV?

A fund is a pool of assets that many investors own together. **NAV (Net Asset Value)** is simply the price of one share in a fund:

```
NAV = (Total Value of Everything in the Fund - liabilities) ÷ Number of Shares
```

For example, if a fund holds $10 million in assets and has 10 million shares outstanding, each share is worth $1.00.

**NAV Strikes** are fixed times during the trading day when fund shares are priced and orders are executed. Traditional funds typically have one daily strike at market close, but Solana enables multiple intraday strikes.

## Executive Summary

This reference implementation demonstrates how **money market funds can implement multiple daily NAV strikes on Solana**, enabling institutional clients to subscribe and redeem fund shares at specific intraday settlement periods.

Using SPL Token 2022 features and atomic transactions, funds can offer multiple NAV calculation points throughout the trading day, providing institutional investors with greater flexibility and faster settlement than traditional systems.

## Key Features

| Feature           | Traditional NAV   | Solana NAV Strikes   |
| ----------------- | ----------------- | -------------------- |
| Strike Frequency  | Once daily (4 PM) | 4+ times daily       |
| Settlement        | T+1 or T+2        | T+0 (instant)        |
| Processing Cost   | $50-200           | <$0.01               |
| Pricing Certainty | Unknown until 4PM | Execute at exact NAV |
| Transparency      | End-of-day        | Real-time on-chain   |

## Quick Start

### Prerequisites

1. **Node.js** >= 18.0.0
2. **Solana CLI** installed ([installation guide](https://docs.solana.com/cli/install-solana-cli-tools))
3. **Local Test Validator** (comes with Solana CLI)

### Installation

```bash
npm install
```

### Run Demo on Local Validator

**Terminal 1: Start local validator**

```bash
solana-test-validator
```

**Terminal 2: Run the demo**

```bash
npm run demo
```

The demo will:

1. Create a fund token with Token 2022 + Metadata extensions
2. Whitelist investors (Investor A and Investor B)
3. Process subscriptions (USDC → Fund Shares) at NAV $1.00
4. Execute multiple NAV strikes ($1.00 → $1.01 → $1.02 → $1.03)
5. Process redemptions (Fund Shares → USDC)
6. Display Solana Explorer links for all transactions
7. Show final balances and daily summary

### Demo Output

The demo uses simple, easy-to-understand numbers:

- Investor A: $500 USDC → subscribes $250, then $100 more
- Investor B: $300 USDC → subscribes $150, redeems 50 shares
- NAV moves: $1.00 → $1.01 → $1.02 → $1.03

All transaction signatures are printed as clickable Solana Explorer links.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    NAV Strike Engine                        │
├─────────────────────────────────────────────────────────────┤
│ • Fund Token Creation (Token-2022 + Metadata)               │
│ • NAV Calculation & On-Chain Updates                        │
│ • Subscription Processing (USDC → Shares)                   │
│ • Redemption Processing (Shares → USDC)                     │
│ • Whitelist Management (Freeze/Thaw)                        │
│ • Atomic Transaction Settlement                             │
└─────────────────────────────────────────────────────────────┘
```

### NAV Strike Timeline

```
Trading Day Timeline:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
│     │        │        │        │        │
8:00  9:30    12:00    14:30    16:00    17:00
      ↑        ↑        ↑        ↑
   Strike 1  Strike 2  Strike 3  Strike 4
   NAV=$1.00  $1.01    $1.02    $1.03
```

## Project Structure

```
nav-strikes-reference/
├── src/
│   ├── index.ts                 # Main exports
│   ├── types.ts                 # Type definitions
│   ├── nav-strike-engine.ts     # Core NAV Strike Engine
│   ├── test-usdc.ts             # Test USDC utilities
│   └── examples/
│       └── daily-strikes.ts     # Full demo script
├── nav-strikes.mdx              # Comprehensive guide (solana.com format)
├── package.json
├── tsconfig.json
└── README.md
```

## Core Components

### NAVStrikeEngine

The main engine class that manages fund operations on Solana:

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import { NAVStrikeEngine } from "nav-strikes-reference";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const fundAdmin = Keypair.generate();

const engine = new NAVStrikeEngine(connection, fundAdmin);

// Create fund token
const fundMint = await engine.createFundToken(fundAdmin, {
  name: "Example Money Market Fund",
  symbol: "EX-MMF",
  initialNAV: 1.0,
  strikeSchedule: ["09:30", "12:00", "14:30", "16:00"],
});

// Whitelist investor
await engine.whitelistInvestor(fundMint, investor.publicKey, fundAdmin);

// Delegate USDC before subscription
await engine.delegateUSDCForSubscription(investor, usdcMint, 250);

// Queue order and execute strike
engine.queueOrder(investor.publicKey, "subscribe", 250);
await engine.executeStrike(fundMint, usdcMint, 1.0);
```

### Fund Token Structure (Token-2022)

**Token Configuration:**

- Program: SPL Token 2022
- Decimals: 6 (matching USDC)
- Extensions: MetadataPointer, DefaultAccountState (Frozen)

**On-Chain Metadata Fields:**

```json
{
  "name": "Example Money Market Fund",
  "symbol": "EX-MMF",
  "currentNAV": "1.020000",
  "lastStrikeTime": "2024-01-15T14:30:00Z",
  "strikeSchedule": "[\"09:30\", \"12:00\", \"14:30\", \"16:00\"]",
  "totalAUM": "449.00",
  "fundType": "Money Market Fund"
}
```

## Workflows

### Subscription Flow (USDC → Fund Shares)

```
1. Investor delegates USDC to fund administrator (investor signs)
2. Investor queues order (no signature needed)
3. At strike time, fund admin executes atomic transaction:
   ├── Transfer USDC from investor to fund (using delegation)
   └── Mint fund shares to investor at NAV
4. Settlement complete in <1 second
```

### Redemption Flow (Fund Shares → USDC)

```
1. Investor delegates shares to fund administrator (investor signs)
2. Investor queues redemption order (no signature needed)
3. At strike time, fund admin executes atomic transaction:
   ├── Burn fund shares from investor (using delegation)
   └── Transfer USDC to investor at NAV
4. Settlement complete in <1 second
```

### Whitelist Flow

```
1. Create investor's fund token account (frozen by default)
2. Thaw account to enable trading (KYC approved)
3. To remove: freeze account
```

## API Reference

### NAVStrikeEngine Methods

| Method                                                    | Description                       |
| --------------------------------------------------------- | --------------------------------- |
| `createFundToken(issuer, config)`                         | Create fund token with Token-2022 |
| `updateNAV(fundMint, newNAV)`                             | Update NAV on-chain               |
| `whitelistInvestor(fundMint, investor, payer)`            | Whitelist an investor             |
| `removeFromWhitelist(fundMint, account)`                  | Remove investor (freeze)          |
| `delegateUSDCForSubscription(investor, usdcMint, amount)` | Delegate USDC                     |
| `delegateSharesForRedemption(investor, fundMint, amount)` | Delegate shares                   |
| `processSubscription(params)`                             | Execute subscription atomically   |
| `processRedemption(params)`                               | Execute redemption atomically     |
| `queueOrder(investor, type, amount)`                      | Queue order for next strike       |
| `executeStrike(fundMint, usdcMint, newNAV)`               | Execute NAV strike                |
| `getFundState(fundMint)`                                  | Get current fund state            |

## Production Considerations

### What This Implementation Provides

✅ Fund token creation with Token 2022 + Metadata  
✅ On-chain NAV storage and updates  
✅ Atomic subscription/redemption settlement  
✅ Compliance controls via freeze/thaw  
✅ Delegated authority pattern  
✅ Solana Explorer links for all transactions

### What Production Requires

#### 1. NAV Calculation

This implementation uses a **trusted administrator** for NAV updates, mirroring traditional fund operations. The fund administrator:

- Fetches prices from data providers (Bloomberg, Reuters, etc.)
- Calculates total portfolio value
- Pushes NAV to on-chain metadata

For crypto-native funds with on-chain assets, a custom Solana program reading Pyth/Switchboard oracles could enable trustless NAV calculation.

#### 2. Regulatory Compliance

- Rule 2a-7 compliance (for US money market funds)
- Daily/weekly liquidity requirements
- Stress testing capabilities
- Regulatory reporting automation
- KYC/AML systems

#### 3. Operational Systems

- Strike schedule management
- Order queuing with cutoff times
- Failed trade handling
- Reconciliation with custodians

#### 4. Security

- Multi-sig for admin operations
- Key management (HSM)
- Rate limiting
- Comprehensive audit logging

## Documentation

For a comprehensive guide in solana.com format, see [`nav-strikes.mdx`](nav-strikes.mdx). This includes:

- Detailed explanation of NAV and NAV strikes
- Full architecture diagrams
- Complete code implementation
- Flow diagrams for subscription/redemption
- Production considerations
- Comparison with traditional systems

## Development

### Build

```bash
npm run build
```

### Type Check

```bash
npm run typecheck
```

### Start Validator

```bash
npm run validator
# or
solana-test-validator
```

## Disclaimer

**⚠️ CRITICAL NOTICE**

This reference implementation demonstrates NAV strike concepts for money market funds on Solana. **It is NOT production-ready.**

**DO NOT use this code directly in production without:**

- Comprehensive security audits
- Regulatory compliance review (Rule 2a-7, etc.)
- Professional fund administration systems
- Proper key management infrastructure
- Extensive testing across all market conditions

The authors assume no responsibility for any use beyond educational exploration.

## License

MIT - See [LICENSE](LICENSE) for details.

---
