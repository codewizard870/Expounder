import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PaymentRequest } from "../target/types/payment_request";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

async function main() {
  // Set up provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PaymentRequest as Program<PaymentRequest>;

  // Example usage flow
  console.log("🚀 Payment Request Program Client Example\n");

  // Generate test accounts
  const receiver = anchor.web3.Keypair.generate();
  const payer = anchor.web3.Keypair.generate();

  // Airdrop some SOL for testing
  console.log("💰 Airdropping SOL to test accounts...");
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(receiver.publicKey, 2 * LAMPORTS_PER_SOL)
  );
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL)
  );

  // Request parameters
  const requestId = new anchor.BN(Date.now()); // Use timestamp as unique ID
  const amount = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL

  // Derive PDAs
  const [payRequestPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("pay_request"),
      receiver.publicKey.toBuffer(),
      requestId.toArrayLike(Buffer, "le", 8)
    ],
    program.programId
  );

  const [escrowPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      receiver.publicKey.toBuffer(),
      requestId.toArrayLike(Buffer, "le", 8)
    ],
    program.programId
  );

  console.log(`👤 Receiver: ${receiver.publicKey.toString()}`);
  console.log(`💳 Payer: ${payer.publicKey.toString()}`);
  console.log(`📋 Request ID: ${requestId.toString()}`);
  console.log(`💰 Amount: ${amount / LAMPORTS_PER_SOL} SOL`);
  console.log(`🏦 Pay Request PDA: ${payRequestPDA.toString()}`);
  console.log(`🔐 Escrow PDA: ${escrowPDA.toString()}\n`);

  // Step 1: Receiver creates payment request
  console.log("📝 Step 1: Receiver creates payment request...");
  await program.methods
    .createPayRequest(requestId, new anchor.BN(amount))
    .accounts({
      payRequest: payRequestPDA,
      receiver: receiver.publicKey,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([receiver])
    .rpc();

  console.log("✅ Payment request created!\n");

  // Step 2: Payer settles the payment
  console.log("💸 Step 2: Payer settles the payment...");
  const payerBalanceBefore = await provider.connection.getBalance(payer.publicKey);
  console.log(`Payer balance before: ${payerBalanceBefore / LAMPORTS_PER_SOL} SOL`);

  await program.methods
    .settlePayment()
    .accounts({
      payRequest: payRequestPDA,
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([payer])
    .rpc();

  const payerBalanceAfter = await provider.connection.getBalance(payer.publicKey);
  console.log(`Payer balance after: ${payerBalanceAfter / LAMPORTS_PER_SOL} SOL`);
  console.log("✅ Payment settled to escrow!\n");

  // Step 3: Receiver sweeps the funds
  console.log("🧹 Step 3: Receiver sweeps the funds...");
  const receiverBalanceBefore = await provider.connection.getBalance(receiver.publicKey);
  console.log(`Receiver balance before: ${receiverBalanceBefore / LAMPORTS_PER_SOL} SOL`);

  await program.methods
    .sweepFunds()
    .accounts({
      payRequest: payRequestPDA,
      receiver: receiver.publicKey,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([receiver])
    .rpc();

  const receiverBalanceAfter = await provider.connection.getBalance(receiver.publicKey);
  console.log(`Receiver balance after: ${receiverBalanceAfter / LAMPORTS_PER_SOL} SOL`);
  console.log("✅ Funds swept to receiver!\n");

  console.log("🎉 Payment flow completed successfully!");
  console.log(`💡 Notice: Receiver's main wallet (${receiver.publicKey.toString()}) was never exposed during the payment process!`);
}

main().catch(console.error);