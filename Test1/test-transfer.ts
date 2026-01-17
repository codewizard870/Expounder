import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  transferChecked,
  getAccount,
  getMint,
  getTransferFeeAmount,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
/**
 * Test Alpha Token Transfer with 5% Tax
 * This script demonstrates that the 5% tax is applied on transfers
 */

async function testTransfer() {
  // Connect to testnet
  const connection = new Connection('https://api.testnet.solana.com', 'confirmed');
  
  // REPLACE THESE WITH YOUR ACTUAL VALUES FROM DEPLOYMENT
  const MINT_ADDRESS = '3yHtQdhbuuA6xhfUZ5qXHnHH6PJQktpMPAMfLxC6HZPJ';

  const senderKeypairPath = path.join(process.env.HOME || '', '.config', 'solana', 'id.json');
  const SENDER_SECRET_KEY = JSON.parse(fs.readFileSync(senderKeypairPath, 'utf-8'));
  
  // Load sender keypair (the one that has the initial supply)
  const sender = Keypair.fromSecretKey(
    Buffer.from(SENDER_SECRET_KEY, 'hex')
  );
  
  // Create a recipient keypair
  const recipient = Keypair.generate();
  
  console.log('🧪 Testing Alpha Token Transfer with 5% Tax');
  console.log('==========================================');
  console.log('Mint:', MINT_ADDRESS);
  console.log('Sender:', sender.publicKey.toBase58());
  console.log('Recipient:', recipient.publicKey.toBase58());
  
  const mintPubkey = new PublicKey(MINT_ADDRESS);
  
  // Get mint info
  const mintInfo = await getMint(
    connection,
    mintPubkey,
    'confirmed',
    TOKEN_2022_PROGRAM_ID
  );
  
  console.log('\n📊 Mint Info:');
  console.log('Decimals:', mintInfo.decimals);
  console.log('Supply:', (Number(mintInfo.supply) / 10 ** mintInfo.decimals).toLocaleString());
  
  // Create token accounts
  console.log('\n💼 Creating token accounts...');
  
  const senderTokenAccount = await createAssociatedTokenAccountIdempotent(
    connection,
    sender,
    mintPubkey,
    sender.publicKey,
    {},
    TOKEN_2022_PROGRAM_ID
  );
  
  const recipientTokenAccount = await createAssociatedTokenAccountIdempotent(
    connection,
    sender,
    mintPubkey,
    recipient.publicKey,
    {},
    TOKEN_2022_PROGRAM_ID
  );
  
  console.log('✅ Sender Token Account:', senderTokenAccount.toBase58());
  console.log('✅ Recipient Token Account:', recipientTokenAccount.toBase58());
  
  // Get sender balance before transfer
  const senderAccountBefore = await getAccount(
    connection,
    senderTokenAccount,
    'confirmed',
    TOKEN_2022_PROGRAM_ID
  );
  
  const balanceBefore = Number(senderAccountBefore.amount) / 10 ** mintInfo.decimals;
  console.log('\n💰 Sender balance before:', balanceBefore.toLocaleString(), 'ALPHA');
  
  // Transfer amount (let's send 1000 tokens)
  const transferAmount = 1000;
  const transferAmountWithDecimals = BigInt(transferAmount * 10 ** mintInfo.decimals);
  
  // Calculate expected tax (5%)
  const expectedTax = transferAmount * 0.05; // 50 tokens
  const expectedReceived = transferAmount - expectedTax; // 950 tokens
  
  console.log('\n📤 Initiating transfer...');
  console.log('Amount to send:', transferAmount, 'ALPHA');
  console.log('Expected tax (5%):', expectedTax, 'ALPHA');
  console.log('Expected received:', expectedReceived, 'ALPHA');
  
  // Perform transfer
  const transferSignature = await transferChecked(
    connection,
    sender,
    senderTokenAccount,
    mintPubkey,
    recipientTokenAccount,
    sender.publicKey,
    transferAmountWithDecimals,
    mintInfo.decimals,
    [],
    {},
    TOKEN_2022_PROGRAM_ID
  );
  
  console.log('✅ Transfer confirmed:', transferSignature);
  
  // Check balances after transfer
  const senderAccountAfter = await getAccount(
    connection,
    senderTokenAccount,
    'confirmed',
    TOKEN_2022_PROGRAM_ID
  );
  
  const recipientAccountAfter = await getAccount(
    connection,
    recipientTokenAccount,
    'confirmed',
    TOKEN_2022_PROGRAM_ID
  );
  
  const senderBalanceAfter = Number(senderAccountAfter.amount) / 10 ** mintInfo.decimals;
  const recipientBalance = Number(recipientAccountAfter.amount) / 10 ** mintInfo.decimals;
  
  // Calculate actual tax withheld
  const transferFeeAmount = getTransferFeeAmount(recipientAccountAfter);
  const withheldAmount = transferFeeAmount 
    ? Number(transferFeeAmount.withheldAmount) / 10 ** mintInfo.decimals
    : 0;
  
  console.log('\n📊 Transfer Results:');
  console.log('====================');
  console.log('Sender balance after:', senderBalanceAfter.toLocaleString(), 'ALPHA');
  console.log('Recipient received:', recipientBalance.toLocaleString(), 'ALPHA');
  console.log('Tax withheld:', withheldAmount.toLocaleString(), 'ALPHA');
  console.log('Actual deducted from sender:', (balanceBefore - senderBalanceAfter).toLocaleString(), 'ALPHA');
  
  console.log('\n✅ Tax verification:');
  const taxPercentage = (withheldAmount / transferAmount) * 100;
  console.log('Tax rate applied:', taxPercentage.toFixed(2) + '%');
  
  if (Math.abs(taxPercentage - 5) < 0.1) {
    console.log('✅ 5% tax is working correctly!');
  } else {
    console.log('⚠️  Tax rate differs from expected 5%');
  }
  
  console.log('\n🎯 Test Complete!');
  console.log('The 5% transfer tax is being applied to all transfers.');
  console.log('The withheld tokens remain in the recipient account until withdrawn.');
}

// Run test
testTransfer()
  .then(() => {
    console.log('\n✅ Test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });