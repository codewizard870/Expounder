# ZK Payment Request Program

A Solana program that implements zero-knowledge enhanced payment requests with maximum privacy, making transactions even less traceable than traditional payment request systems.

## Overview

This program advances privacy-preserving payment requests by integrating zero-knowledge proofs (ZKPs) with Program Derived Addresses (PDAs) for escrow. The key innovation is that payment amounts are committed using ZK techniques, and proofs verify payment properties without revealing sensitive details. This makes the payment system significantly more private than traditional approaches.

### Enhanced Privacy Features

- **Amount Commitments**: Payment amounts are hidden using Pedersen commitments
- **Range Proofs**: Prove amounts are within valid ranges without revealing the exact value
- **Settlement Commitments**: Hide settlement details with cryptographic commitments
- **Proof Verification**: All operations require valid ZK proofs for authentication

### Deployed Program Address

**Localnet:** `11111111111111111111111111111112`

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

## How It Works

### 1. Create ZK Payment Request
- Receiver generates a unique request ID and amount range
- Creates Pedersen commitment to hide the payment amount
- Generates range proof to prove amount is within acceptable bounds
- Program creates ZK-enhanced PDAs for secure escrow

### 2. Settle ZK Payment
- Payer provides payment with ZK proof of correct amount
- Proof verifies amount matches the committed value
- Funds transfer to ZK escrow PDA with settlement commitment
- No amount or payer identity revealed on-chain

### 3. Sweep ZK Funds
- Receiver proves ownership with ZK verification
- Funds claimed from escrow with enhanced privacy
- All accounts closed and rent returned
- Minimal on-chain footprint remains

## Key Features

- **Zero-Knowledge Amount Hiding**: Amounts committed cryptographically, never revealed
- **Range Proof Verification**: Prove amounts are valid without showing values
- **Enhanced PDA Security**: ZK-prefixed PDAs prevent collision attacks
- **Settlement Privacy**: Payment details hidden with cryptographic commitments
- **Proof-Based Authentication**: All operations require valid ZK proofs
- **Ephemeral Accounts**: Complete cleanup after transaction completion

## ZK PDA Structure

```
ZK Pay Request PDA: [b"zk_pay_request", receiver_pubkey, request_id]
ZK Escrow PDA: [b"zk_escrow", receiver_pubkey, request_id]
```

## Program Instructions

### `create_zk_pay_request`
Creates a new ZK payment request with amount commitment and range proof.

**Parameters:**
- `request_id: u64` - Unique identifier for the request
- `amount_commitment: [u8; 32]` - Pedersen commitment to payment amount
- `amount_range_proof: Vec<u8>` - Range proof data
- `min_amount: u64` - Minimum acceptable amount
- `max_amount: u64` - Maximum acceptable amount

### `settle_zk_payment`
Transfers funds with ZK proof verification of correct amount.

**Parameters:**
- `amount: u64` - Actual payment amount
- `payment_proof: Vec<u8>` - ZK proof that amount matches commitment

### `sweep_zk_funds`
Claims funds with ZK receiver verification and closes accounts.

**Parameters:**
- `receiver_proof: Vec<u8>` - ZK proof of receiver authorization

## Privacy Advantages Over Traditional Systems

Compared to Test2's PDA-based system, Test3 provides maximum privacy through advanced ZK cryptography:

- **Pedersen Commitments**: Amounts hidden using ark-crypto-primitives commitment schemes
- **Bulletproof Range Proofs**: Prove amounts are within ranges without revealing exact values
- **Stealth Addresses**: One-time addresses generated using HKDF for each transaction
- **Ownership Proofs**: Receivers prove ownership without revealing identity
- **Settlement Commitments**: Transaction details hidden with cryptographic commitments
- **Complete Untraceability**: No linkage between payment requests, settlements, and withdrawals

## Security Considerations

- **ZK Proof Validation**: All proofs cryptographically verified before execution
- **Commitment Integrity**: Amount commitments prevent manipulation
- **Range Proof Security**: Prevents invalid amounts within committed ranges
- **Access Control**: ZK proofs required for all privileged operations
- **State Validation**: Prevents double-spending and replay attacks
- **Account Security**: ZK-prefixed PDAs prevent collision attacks
- **Ephemeral Design**: Complete cleanup prevents state accumulation

## ZK Implementation Details

This implementation uses battle-tested ZK cryptography libraries for maximum privacy:

- **ark-crypto-primitives**: Pedersen commitments for amount hiding
- **ark-bls12-381 + ark-ff**: Elliptic curve operations for commitments
- **bulletproofs**: Zero-knowledge range proofs for amount validation
- **curve25519-dalek**: Additional elliptic curve cryptography
- **merlin**: Fiat-Shamir transcript construction for proofs
- **hkdf + sha3**: Stealth address generation and hashing

### Cryptographic Flow:
1. **Amount Commitment**: Pedersen commitment hides the exact payment amount
2. **Range Proof**: Bulletproof proves amount is within acceptable bounds
3. **Stealth Address**: HKDF-derived one-time address prevents transaction linking
4. **Ownership Proof**: Zero-knowledge proof of address ownership
5. **Settlement**: Commitment-based transaction recording
6. **Withdrawal**: Verified ownership proof allows fund claiming

All proofs are cryptographically verifiable while maintaining complete privacy.

## Future Enhancements

- Full ZK-SNARK integration
- SPL token support with ZK proofs
- Multi-party ZK payments
- Time-locked ZK commitments
- Batch ZK operations
- Cross-chain ZK privacy
- Advanced commitment schemes

## Testing

Run the comprehensive ZK test suite:

```bash
anchor test
```

Tests cover:
- ✅ ZK payment request creation with commitments
- ✅ Range proof validation
- ✅ ZK payment settlement with proof verification
- ✅ ZK fund sweeping with receiver proofs
- ✅ Amount range enforcement
- ✅ Security validations and error handling
- ✅ Multiple concurrent ZK requests
- ✅ Account closure and cleanup

## Dependencies

- `bulletproofs`: Zero-knowledge range proofs
- `curve25519-dalek`: Elliptic curve operations
- `merlin`: Fiat-Shamir transcript construction
- `sha3`: Cryptographic hashing
- `zkp`: Zero-knowledge proof toolbox

## License

MIT