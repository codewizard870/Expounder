# Alpha Token - Solana Deployment Guide

## Overview

This project deploys the **Alpha** token on Solana testnet with the following specifications:

- **Ticker**: ALPHA
- **Total Supply**: 1,000,000 tokens
- **Transfer Tax**: 5% on all buy/sell/transfer operations
- **Status**: Fully renounced (no one can ever claim ownership or modify)

## Technical Details

- **Token Program**: 3yHtQdhbuuA6xhfUZ5qXHnHH6PJQktpMPAMfLxC6HZPJ
- **Extension Used**: Transfer Fee Config
- **Tax Mechanism**: Built-in transfer fee (5% = 500 basis points)
- **Tax Collector**: CPkBLKtV7Nqaeaqj9tu6vEBF4NXuLhuzwgSF9spXQMo2
- **Decimals**: 9
- **Network**: Solana Testnet

## How the 5% Tax Works

The Token-2022 program's **Transfer Fee Extension** automatically:
1. Deducts 5% from every transfer
2. Withholds the tax in the recipient's account
3. Tax can be collected to a designated wallet

**Important**: The tax is withheld at the protocol level, making it impossible to bypass.

## Prerequisites

```bash
# Install Node.js (v18 or higher)
# Install dependencies
npm install

# Or use yarn
yarn install
```

## Installation

1. **Clone or create the project directory**:
```bash
mkdir alpha-token
cd alpha-token
```

2. **Create the following files**:
   - `package.json`
   - `deploy.ts`
   - `test-transfer.ts`
   - `tsconfig.json`

3. **Create tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["*.ts"],
  "exclude": ["node_modules"]
}
```

4. **Install dependencies**:
```bash
npm install
```

## Deployment Steps

### Step 1: Deploy the Token

```bash
npm run deploy
```

This script will:
1. ✅ Connect to Solana testnet
2. ✅ Request airdrop for transaction fees
3. ✅ Create the mint account with transfer fee extension
4. ✅ Configure 5% transfer tax
5. ✅ Mint 1,000,000 tokens to initial supply wallet
6. ✅ **Renounce all authorities** (mint, transfer fee config, withheld withdraw)

### Step 2: Save the Output

The script will output:
- **Mint Address**: The token's public address (share this)
- **Payer Address**: Initial token holder
- **Tax Collector Address**: Where taxes can be withdrawn
- **Private Keys**: SAVE THESE SECURELY!

Example output:
```
🎉 DEPLOYMENT COMPLETE!
========================
Token Name: Alpha
Ticker: ALPHA
Mint Address: 3yHtQdhbuuA6xhfUZ5qXHnHH6PJQktpMPAMfLxC6HZPJ
Total Supply: 1,000,000 tokens
Transfer Tax: 5% (500 basis points)
Token Program: Token-2022 (Token Extensions)
Status: RENOUNCED ✅

⚠️  All authorities have been revoked.
⚠️  No one can ever change this token or mint more supply.
```

### Step 3: Verify the Tax (Optional)

```bash
# Edit test-transfer.ts with your mint address and sender secret key
npm run test-transfer
```

This will:
- Transfer tokens between accounts
- Verify that exactly 5% is withheld as tax
- Display before/after balances

## Understanding "Renounced"

After deployment, the following authorities are set to `null`:

1. **Mint Authority**: ❌ No one can mint more tokens
2. **Transfer Fee Config Authority**: ❌ No one can change the 5% tax rate
3. **Withheld Withdraw Authority**: ❌ No one can withdraw accumulated taxes
4. **Freeze Authority**: ❌ Was never set (accounts can't be frozen)

**This means**:
- ✅ Total supply is permanently fixed at 1,000,000
- ✅ Tax rate is permanently fixed at 5%
- ✅ No centralized control
- ✅ Truly decentralized token

## Tax Collection Mechanism

The 5% tax is **automatically withheld** in each recipient's token account. Since the withdraw authority is renounced:
- Taxes accumulate in individual accounts
- Cannot be collected to a central wallet
- This ensures true decentralization

**Alternative**: If you want taxes to go to a specific wallet, DO NOT renounce the `WithheldWithdraw` authority and set it to a tax collector wallet address instead.

## Viewing Your Token

1. **On Solana Explorer**:
   - Visit: https://explorer.solana.com/?cluster=testnet
   - Paste your mint address
   - View token details, supply, holders

2. **In Phantom/Solflare Wallet**:
   - Switch to testnet
   - Import token using mint address
   - View balance and transfer

3. **Using Solana CLI**:
```bash
solana config set --url testnet
spl-token display <MINT_ADDRESS> --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
```

## Production Deployment (Mainnet)

To deploy on mainnet:

1. **Change the RPC endpoint** in `deploy.ts`:
```typescript
const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
```

2. **Fund your payer wallet** with real SOL:
   - You'll need ~0.1 SOL for deployment
   - Get SOL from exchanges (Coinbase, Binance, etc.)

3. **Use a secure keypair**:
   - Don't generate randomly
   - Use a hardware wallet or secure key management
   - Never share private keys

4. **Consider tax collection**:
   - Decide if you want to keep `WithheldWithdraw` authority
   - If yes, set it to a secure multisig wallet

5. **Run deployment**:
```bash
npm run deploy
```

## Security Considerations

⚠️ **IMPORTANT SECURITY NOTES**:

1. **Private Keys**: The deployment script shows private keys in hex format. In production:
   - Store in encrypted key files
   - Use environment variables
   - Never commit to version control
   - Consider hardware wallets

2. **Renunciation is Permanent**: Once renounced, you CANNOT:
   - Mint more tokens
   - Change the tax rate
   - Recover from bugs or issues
   - Update the contract

3. **Test Thoroughly**: Deploy and test on testnet multiple times before mainnet

4. **Audit**: For production tokens, get a smart contract audit

## Troubleshooting

### "Insufficient funds"
- Make sure your payer wallet has SOL
- On testnet, use the airdrop function in the script
- On mainnet, fund your wallet before deployment

### "Invalid mint"
- Ensure you're using TOKEN_2022_PROGRAM_ID
- Token-2022 addresses are different from regular SPL tokens

### "Transaction failed"
- Check network status: https://status.solana.com
- Try increasing commitment level to 'finalized'
- Check Solana Explorer for transaction details

### Tax not working
- Verify you're using Token-2022 program
- Check mint info with: `spl-token display <MINT>`
- Ensure TransferFeeConfig extension is enabled

## Additional Resources

- [Solana Token-2022 Documentation](https://spl.solana.com/token-2022)
- [Transfer Fee Extension Guide](https://spl.solana.com/token-2022/extensions#transfer-fees)
- [Solana Cookbook](https://solanacookbook.com/)
- [Solana Web3.js Docs](https://solana-labs.github.io/solana-web3.js/)

## FAQ

**Q: Can I change the tax rate after deployment?**  
A: No, after renouncing the TransferFeeConfig authority, the 5% rate is permanent.

**Q: Where do the taxes go?**  
A: Taxes are withheld in each recipient's account. Since withdraw authority is renounced, they stay there permanently. To collect taxes, don't renounce the WithheldWithdraw authority.

**Q: Can I mint more tokens later?**  
A: No, after renouncing mint authority, the supply is fixed at 1,000,000.

**Q: Is this compatible with DEXs?**  
A: Most modern Solana DEXs support Token-2022. Check with specific DEX documentation.

**Q: Can I freeze accounts?**  
A: No, freeze authority was never set and cannot be added after deployment.

## License

MIT

## Disclaimer

This code is provided as-is for educational purposes. Deploying tokens on mainnet involves financial risk. Always test thoroughly and consider professional audit before mainnet deployment.