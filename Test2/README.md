# Payment Request Program

A Solana program that enables receivers to create payment requests with PDA-based escrow, allowing payers to settle payments without revealing the receiver's main wallet address on-chain.

## Overview

This program implements a privacy-preserving payment request system using Program Derived Addresses (PDAs) for escrow. The key innovation is that funds flow through an ephemeral escrow account, and the receiver's main wallet is never exposed during the payment process.

## How It Works

### 1. Create Payment Request
- Receiver generates a unique request ID
- Program creates two PDAs:
  - `pay_request` PDA: Stores payment metadata
  - `escrow` PDA: Temporary holding account for funds
- Receiver can share the escrow PDA address as the "payment link"

### 2. Settle Payment
- Payer transfers funds directly to the escrow PDA
- No knowledge of receiver's main wallet required
- Funds are held securely in escrow

### 3. Sweep Funds
- Receiver claims funds from escrow to their main wallet
- Payment request account is closed (ephemeral)
- Rent is returned to receiver

## Key Features

- **Privacy-Preserving**: Receiver's main wallet never appears on-chain during payment
- **Trust-Minimized**: Uses PDAs and program logic instead of trusted intermediaries
- **Ephemeral Escrow**: Escrow accounts are cleaned up after use
- **Unique Request IDs**: Each request has a unique identifier for tracking
- **SOL Support**: Currently supports SOL payments (easily extensible to SPL tokens)

## PDA Structure

```
Pay Request PDA: [b"pay_request", receiver_pubkey, request_id]
Escrow PDA: [b"escrow", receiver_pubkey, request_id]
```

## Program Instructions

### `create_pay_request`
Creates a new payment request with escrow PDA.

**Parameters:**
- `request_id: u64` - Unique identifier for the request
- `amount: u64` - Payment amount in lamports

### `settle_payment`
Transfers funds from payer to escrow PDA.

**Parameters:** None (reads amount from pay request account)

### `sweep_funds`
Claims funds from escrow to receiver's wallet and closes accounts.

## Usage

### Build and Deploy

```bash
# Install dependencies
yarn install

# Build the program
anchor build

# Deploy to localnet
anchor deploy

# Run tests
anchor test
```

### Client Example

```typescript
// See app/client.ts for complete example
const requestId = new anchor.BN(Date.now());
const amount = 0.1 * LAMPORTS_PER_SOL;

// Create request
await program.methods.createPayRequest(requestId, new anchor.BN(amount))...

// Payer settles
await program.methods.settlePayment()...

// Receiver sweeps
await program.methods.sweepFunds()...
```

## Security Considerations

- **Access Control**: Only the original receiver can sweep funds
- **State Validation**: Prevents double-spending and unauthorized access
- **Account Closure**: Ephemeral accounts prevent state accumulation
- **PDA Security**: Program-controlled accounts cannot be manipulated externally

## Future Enhancements

- SPL token support
- Multi-signature sweeping
- Time-locked payments
- Refund mechanisms
- Batch operations

## Testing

Run the comprehensive test suite:

```bash
anchor test
```

Tests cover:
- ✅ Payment request creation
- ✅ Payment settlement
- ✅ Fund sweeping
- ✅ Security validations
- ✅ Error handling
- ✅ Account closure

## License

MIT