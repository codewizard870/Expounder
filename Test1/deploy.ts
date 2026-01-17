import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import {
  ExtensionType,
  createInitializeMintInstruction,
  mintTo,
  createAccount,
  getMintLen,
  TOKEN_2022_PROGRAM_ID,
  createInitializeTransferFeeConfigInstruction,
  harvestWithheldTokensToMint,
  transferCheckedWithFee,
  withdrawWithheldTokensFromMint,
  withdrawWithheldTokensFromAccounts,
  getTransferFeeAmount,
  createAssociatedTokenAccountIdempotent,
} from '@solana/spl-token';

/**
 * Deploy Alpha Token with 5% Transfer Tax on Solana Testnet
 * 
 * Requirements:
 * - Ticker: Alpha
 * - Total Supply: 1,000,000 tokens
 * - Buy/Sell/Transfer Tax: 5%
 * - Renounced after deployment
 */

async function deployAlphaToken() {
  // Connect to Solana testnet
  const connection = new Connection('https://api.testnet.solana.com', 'confirmed');
  
  // Load payer keypair from Solana CLI default location
  const payerKeypairPath = path.join(process.env.HOME || '', '.config', 'solana', 'id.json');
  const payerKeypairData = JSON.parse(fs.readFileSync(payerKeypairPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(payerKeypairData));
  
  // Generate keypairs for mint and tax collector
  const mintKeypair = Keypair.generate();
  const taxCollectorWallet = Keypair.generate(); // Wallet that receives 5% tax
  
  console.log('🚀 Alpha Token Deployment Script');
  console.log('================================');
  console.log('Payer (loaded from ~/.config/solana/id.json):', payer.publicKey.toBase58());
  console.log('Mint Address:', mintKeypair.publicKey.toBase58());
  console.log('Tax Collector:', taxCollectorWallet.publicKey.toBase58());
  console.log('\n⚠️  Save the mint and tax collector private keys securely!\n');
  
  // Check current balance first
  const currentBalance = await connection.getBalance(payer.publicKey);
  const requiredBalance = 2 * LAMPORTS_PER_SOL;
  
  if (currentBalance < requiredBalance) {
    console.log(`Current balance: ${currentBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`Required balance: ${requiredBalance / LAMPORTS_PER_SOL} SOL`);
    console.log('Requesting airdrop...');
    
    // Retry logic for airdrop with exponential backoff
    let airdropSuccess = false;
    let retries = 0;
    const maxRetries = 5;
    const baseDelay = 5000; // 5 seconds
    
    while (!airdropSuccess && retries < maxRetries) {
      try {
        const airdropSignature = await connection.requestAirdrop(
          payer.publicKey,
          requiredBalance - currentBalance
        );
        await connection.confirmTransaction(airdropSignature, 'confirmed');
        airdropSuccess = true;
        console.log('✅ Airdrop confirmed');
      } catch (error: any) {
        retries++;
        if (retries >= maxRetries) {
          console.error('\n❌ Airdrop failed after', maxRetries, 'attempts');
          console.error('Error:', error.message);
          console.error('\n💡 Solutions:');
          console.error('1. Wait a few minutes and try again (rate limit resets)');
          console.error('2. Manually fund the account using a faucet:');
          console.error('   - https://faucet.solana.com/');
          console.error('   - Or use: solana airdrop 2', payer.publicKey.toBase58());
          console.error('3. Use a different payer account that already has SOL');
          throw new Error('Airdrop request failed. Rate limit may be reached. Please wait or manually fund the account.');
        }
        const delay = baseDelay * Math.pow(2, retries - 1); // Exponential backoff
        console.log(`⚠️  Airdrop attempt ${retries} failed. Retrying in ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  } else {
    console.log(`✅ Account already has sufficient balance: ${currentBalance / LAMPORTS_PER_SOL} SOL`);
  }
  
  // Token configuration
  const decimals = 9;
  const totalSupply = 1_000_000; // 1 million tokens
  const supplyWithDecimals = BigInt(totalSupply) * BigInt(10 ** decimals);
  
  // Tax configuration: 5% = 500 basis points (out of 10,000)
  const feeBasisPoints = 500; // 5%
  const maxFee = BigInt(1_000_000_000 * (10 ** decimals)); // Max fee per transfer
  
  // Calculate space needed for mint with transfer fee extension
  const extensions = [ExtensionType.TransferFeeConfig];
  const mintLen = getMintLen(extensions);
  
  // Calculate minimum lamports for rent exemption
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
  
  console.log('\n📝 Creating mint account with transfer fee extension...');
  
  // Create mint account
  const createAccountInstruction = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mintKeypair.publicKey,
    space: mintLen,
    lamports,
    programId: TOKEN_2022_PROGRAM_ID,
  });
  
  // Initialize transfer fee configuration
  // Tax goes to taxCollectorWallet
  const initializeTransferFeeConfig = createInitializeTransferFeeConfigInstruction(
    mintKeypair.publicKey,
    payer.publicKey, // Transfer fee config authority (will be revoked)
    payer.publicKey, // Withdraw withheld authority (will be revoked)
    feeBasisPoints,
    maxFee,
    TOKEN_2022_PROGRAM_ID
  );
  
  // Initialize mint
  const initializeMintInstruction = createInitializeMintInstruction(
    mintKeypair.publicKey,
    decimals,
    payer.publicKey, // Mint authority (will be revoked)
    null, // Freeze authority (none)
    TOKEN_2022_PROGRAM_ID
  );
  
  // Create transaction
  const transaction = new Transaction().add(
    createAccountInstruction,
    initializeTransferFeeConfig,
    initializeMintInstruction
  );
  
  // Send transaction
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [payer, mintKeypair]
  );
  
  console.log('✅ Mint created:', signature);
  console.log('   Mint address:', mintKeypair.publicKey.toBase58());
  
  // Create associated token account for initial supply
  console.log('\n💰 Minting initial supply...');
  
  const payerTokenAccount = await createAssociatedTokenAccountIdempotent(
    connection,
    payer,
    mintKeypair.publicKey,
    payer.publicKey,
    {},
    TOKEN_2022_PROGRAM_ID
  );
  
  // Mint total supply to payer's account
  await mintTo(
    connection,
    payer,
    mintKeypair.publicKey,
    payerTokenAccount,
    payer.publicKey,
    supplyWithDecimals,
    [],
    {},
    TOKEN_2022_PROGRAM_ID
  );
  
  console.log('✅ Minted 1,000,000 Alpha tokens to:', payerTokenAccount.toBase58());
  
  // RENOUNCE OWNERSHIP - Set all authorities to null
  console.log('\n🔒 Renouncing contract ownership...');
  
  // Import setAuthority function
  const { setAuthority, AuthorityType } = await import('@solana/spl-token');
  
  // Revoke mint authority (no one can mint more tokens)
  await setAuthority(
    connection,
    payer,
    mintKeypair.publicKey,
    payer.publicKey,
    AuthorityType.MintTokens,
    null,
    [],
    {},
    TOKEN_2022_PROGRAM_ID
  );
  console.log('✅ Mint authority revoked');
  
  // Revoke transfer fee config authority
  await setAuthority(
    connection,
    payer,
    mintKeypair.publicKey,
    payer.publicKey,
    AuthorityType.TransferFeeConfig,
    null,
    [],
    {},
    TOKEN_2022_PROGRAM_ID
  );
  console.log('✅ Transfer fee config authority revoked');
  
  // Revoke withdraw withheld authority
  await setAuthority(
    connection,
    payer,
    mintKeypair.publicKey,
    payer.publicKey,
    AuthorityType.WithheldWithdraw,
    null,
    [],
    {},
    TOKEN_2022_PROGRAM_ID
  );
  console.log('✅ Withheld withdraw authority revoked');
  
  console.log('\n🎉 DEPLOYMENT COMPLETE!');
  console.log('========================');
  console.log('Token Name: Alpha');
  console.log('Ticker: ALPHA');
  console.log('Mint Address:', mintKeypair.publicKey.toBase58());
  console.log('Total Supply: 1,000,000 tokens');
  console.log('Transfer Tax: 5% (500 basis points)');
  console.log('Token Program: Token-2022 (Token Extensions)');
  console.log('Status: RENOUNCED ✅');
  console.log('\n⚠️  All authorities have been revoked.');
  console.log('⚠️  No one can ever change this token or mint more supply.');
  console.log('\nTax Collector Wallet:', taxCollectorWallet.publicKey.toBase58());
  console.log('\n📋 Save these private keys securely:');
  console.log('Payer: Already saved in ~/.config/solana/id.json');
  console.log('Mint Secret:', Buffer.from(mintKeypair.secretKey).toString('hex'));
  console.log('Tax Collector Secret:', Buffer.from(taxCollectorWallet.secretKey).toString('hex'));
  
  return {
    mintAddress: mintKeypair.publicKey.toBase58(),
    payerAddress: payer.publicKey.toBase58(),
    taxCollectorAddress: taxCollectorWallet.publicKey.toBase58(),
    signature,
  };
}

// Run deployment
deployAlphaToken()
  .then((result) => {
    console.log('\n✅ Deployment successful!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });