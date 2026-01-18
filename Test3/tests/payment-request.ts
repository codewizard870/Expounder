import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ZkPaymentRequest } from "../target/types/zk_payment_request";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";

describe("zk-payment-request", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.ZkPaymentRequest as Program<ZkPaymentRequest>;

  // Test accounts
  let receiver: anchor.web3.Keypair;
  let payer: anchor.web3.Keypair;
  let otherUser: anchor.web3.Keypair;

  // Request parameters
  const requestId = new anchor.BN(12345);
  const paymentAmount = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL
  const minAmount = 0.05 * LAMPORTS_PER_SOL; // 0.05 SOL
  const maxAmount = 0.2 * LAMPORTS_PER_SOL; // 0.2 SOL

  // PDAs
  let payRequestPDA: PublicKey;
  let escrowPDA: PublicKey;

  before(async () => {
    // Load payer from Anchor.toml wallet
    const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
    const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
    payer = anchor.web3.Keypair.fromSecretKey(new Uint8Array(walletData));

    // Generate test keypairs
    receiver = anchor.web3.Keypair.generate();
    otherUser = anchor.web3.Keypair.generate();

    // Transfer SOL to test accounts
    const transfer2receiverIx = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: receiver.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL, // 1 SOL
    });

    const transfer2otherIx = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: otherUser.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL, // 1 SOL
    });

    const transferTx = new anchor.web3.Transaction().add(transfer2receiverIx).add(transfer2otherIx);
    await provider.connection.confirmTransaction(
      await provider.connection.sendTransaction(transferTx, [payer])
    );

    // Derive PDAs with new ZK prefixes
    [payRequestPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("zk_pay_request"),
        receiver.publicKey.toBuffer(),
        requestId.toArrayLike(Buffer, "le", 8)
      ],
      program.programId
    );

    [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("zk_escrow"),
        receiver.publicKey.toBuffer(),
        requestId.toArrayLike(Buffer, "le", 8)
      ],
      program.programId
    );
  });

  it("Creates a ZK payment request with amount commitment", async () => {
    const receiverBalanceBefore = await provider.connection.getBalance(receiver.publicKey);

    // Create mock range proof (simplified for testing)
    const rangeProof = Buffer.alloc(64, 1); // Mock 64-byte range proof

    // Create amount commitment matching verification formula: hash(amount_le_bytes + rangeProof + "bulletproof_payment")
    const amountLeBytes = Buffer.allocUnsafe(8);
    amountLeBytes.writeBigUInt64LE(BigInt(paymentAmount), 0);
    const verificationData = Buffer.concat([
      amountLeBytes,
      rangeProof,
      Buffer.from('bulletproof_payment')
    ]);
    const amountCommitment = createHash('sha256')
      .update(verificationData)
      .digest();

    // Create ephemeral pubkey (32 bytes)
    const ephemeralPubkey = Buffer.alloc(32, 0x42);

    await program.methods
      .createZkPayRequest(
        requestId,
        Array.from(amountCommitment),
        rangeProof,
        new anchor.BN(minAmount),
        new anchor.BN(maxAmount),
        Array.from(ephemeralPubkey)
      )
      .accounts({
        payRequest: payRequestPDA,
        escrow: escrowPDA,
        receiver: receiver.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([receiver])
      .rpc();

    // Verify the ZK payment request was created
    const payRequestAccount = await program.account.zkPayRequest.fetch(payRequestPDA);
    expect(payRequestAccount.receiver.toString()).to.equal(receiver.publicKey.toString());
    expect(payRequestAccount.requestId.toNumber()).to.equal(requestId.toNumber());
    expect(payRequestAccount.amountCommitment).to.deep.equal(Array.from(amountCommitment));
    expect(payRequestAccount.minAmount.toNumber()).to.equal(minAmount);
    expect(payRequestAccount.maxAmount.toNumber()).to.equal(maxAmount);
    expect(payRequestAccount.isSettled).to.be.false;
    expect(payRequestAccount.isSwept).to.be.false;

    // Check that some SOL was spent for rent
    const receiverBalanceAfter = await provider.connection.getBalance(receiver.publicKey);
    expect(receiverBalanceBefore).to.be.greaterThan(receiverBalanceAfter);
  });

  it("Settles ZK payment with proof verification", async () => {
    const payerBalanceBefore = await provider.connection.getBalance(payer.publicKey);
    const escrowBalanceBefore = await provider.connection.getBalance(escrowPDA);

    // Create payment proof (simplified)
    const paymentProof = createHash('sha256')
      .update(Buffer.from(paymentAmount.toString()))
      .update(Buffer.from('payment_secret'))
      .digest();

    await program.methods
      .settleZkPayment(
        new anchor.BN(paymentAmount),
        paymentProof
      )
      .accounts({
        payRequest: payRequestPDA,
        escrow: escrowPDA,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([payer])
      .rpc();

    // Verify payment was settled
    const payRequestAccount = await program.account.zkPayRequest.fetch(payRequestPDA);
    expect(payRequestAccount.isSettled).to.be.true;
    expect(payRequestAccount.isSwept).to.be.false;
    expect(payRequestAccount.settledAmount.toNumber()).to.equal(paymentAmount);

    // Verify funds are in escrow
    const escrowBalanceAfter = await provider.connection.getBalance(escrowPDA);
    expect(escrowBalanceAfter).to.equal(escrowBalanceBefore + paymentAmount);

    // Verify payer balance decreased
    const payerBalanceAfter = await provider.connection.getBalance(payer.publicKey);
    expect(payerBalanceBefore).to.be.greaterThan(payerBalanceAfter);
  });

  it("Fails to settle already settled ZK payment", async () => {
    try {
      const paymentProof = Buffer.alloc(32, 1); // Mock proof
      await program.methods
        .settleZkPayment(new anchor.BN(paymentAmount), paymentProof)
        .accounts({
          payRequest: payRequestPDA,
          escrow: escrowPDA,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([payer])
        .rpc();
      expect.fail("Should have thrown error for already settled payment");
    } catch (error: any) {
      expect(error.message).to.include("AlreadySettled");
    }
  });

  it("Fails to sweep ZK funds with wrong receiver", async () => {
    try {
      const receiverProof = Buffer.alloc(32, 1); // Mock proof
      const ephemeralSecret = Buffer.alloc(32, 0x11); // Mock ephemeral secret
      await program.methods
        .sweepZkFunds(receiverProof, Array.from(ephemeralSecret))
        .accounts({
          payRequest: payRequestPDA,
          escrow: escrowPDA,
          receiver: otherUser.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([otherUser])
        .rpc();
      expect.fail("Should have thrown error for unauthorized receiver");
    } catch (error: any) {
      expect(error.message).to.include("UnauthorizedReceiver");
    }
  });

  it("Sweeps ZK funds to receiver with proof verification", async () => {
    const receiverBalanceBefore = await provider.connection.getBalance(receiver.publicKey);
    const escrowBalanceBefore = await provider.connection.getBalance(escrowPDA);

    // Create receiver proof (simplified)
    const receiverProof = createHash('sha256')
      .update(receiver.publicKey.toBytes())
      .update(Buffer.from('receiver_secret'))
      .digest();

    // Use the same ephemeral secret that was used when creating the request
    const ephemeralSecret = Buffer.alloc(32, 0x42); // Must match the ephemeralPubkey used in create

    await program.methods
      .sweepZkFunds(receiverProof, Array.from(ephemeralSecret))
      .accounts({
        payRequest: payRequestPDA,
        escrow: escrowPDA,
        receiver: receiver.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([receiver])
      .rpc();

    // Verify payment request account was closed (should fail to fetch)
    try {
      await program.account.zkPayRequest.fetch(payRequestPDA);
      expect.fail("ZK Payment request account should have been closed");
    } catch (error) {
      // Expected - account was closed
    }

    // Verify funds were transferred to receiver
    const receiverBalanceAfter = await provider.connection.getBalance(receiver.publicKey);
    expect(receiverBalanceAfter).to.be.greaterThan(receiverBalanceBefore);

    // Verify escrow is empty
    const escrowBalanceAfter = await provider.connection.getBalance(escrowPDA);
    expect(escrowBalanceAfter).to.equal(0);
  });

  it("Fails to settle payment with amount outside range", async () => {
    // Create a new ZK payment request for range testing
    const rangeRequestId = new anchor.BN(54321);
    const outOfRangeAmount = 0.5 * LAMPORTS_PER_SOL; // 0.5 SOL (above max)

    // Derive PDAs for range test
    const [rangePayRequestPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("zk_pay_request"), receiver.publicKey.toBuffer(), rangeRequestId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [rangeEscrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("zk_escrow"), receiver.publicKey.toBuffer(), rangeRequestId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Create ZK payment request
    const rangeProof = Buffer.alloc(64, 1);
    const ephemeralPubkey = Buffer.alloc(32, 0x55);
    
    // Create amount commitment matching verification formula: hash(amount_le_bytes + rangeProof + "bulletproof_payment")
    const amountLeBytes = Buffer.allocUnsafe(8);
    amountLeBytes.writeBigUInt64LE(BigInt(paymentAmount), 0);
    const verificationData = Buffer.concat([
      amountLeBytes,
      rangeProof,
      Buffer.from('bulletproof_payment')
    ]);
    const amountCommitment = createHash('sha256')
      .update(verificationData)
      .digest();

    await program.methods
      .createZkPayRequest(
        rangeRequestId,
        Array.from(amountCommitment),
        rangeProof,
        new anchor.BN(minAmount),
        new anchor.BN(maxAmount),
        Array.from(ephemeralPubkey)
      )
      .accounts({
        payRequest: rangePayRequestPDA,
        escrow: rangeEscrowPDA,
        receiver: receiver.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([receiver])
      .rpc();

    // Try to settle with amount outside range
    try {
      const paymentProof = Buffer.alloc(32, 1);
      await program.methods
        .settleZkPayment(new anchor.BN(outOfRangeAmount), paymentProof)
        .accounts({
          payRequest: rangePayRequestPDA,
          escrow: rangeEscrowPDA,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([payer])
        .rpc();
      expect.fail("Should have thrown error for amount outside range");
    } catch (error: any) {
      expect(error.message).to.include("AmountOutOfRange");
    }
  });

  it("Creates and settles multiple ZK payment requests", async () => {
    const requestIds = [new anchor.BN(11111), new anchor.BN(22222), new anchor.BN(33333)];
    const amounts = [0.06 * LAMPORTS_PER_SOL, 0.08 * LAMPORTS_PER_SOL, 0.1 * LAMPORTS_PER_SOL];

    for (let i = 0; i < requestIds.length; i++) {
      const reqId = requestIds[i];
      const amt = amounts[i];

      // Derive PDAs
      const [reqPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("zk_pay_request"), receiver.publicKey.toBuffer(), reqId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [escPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("zk_escrow"), receiver.publicKey.toBuffer(), reqId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      // Create request
      const proof = Buffer.alloc(64, i + 1);
      const ephemeralPubkey = Buffer.alloc(32, i + 10);
      
      // Create amount commitment matching verification formula: hash(amount_le_bytes + rangeProof + "bulletproof_payment")
      const amountLeBytes = Buffer.allocUnsafe(8);
      amountLeBytes.writeBigUInt64LE(BigInt(amt), 0);
      const verificationData = Buffer.concat([
        amountLeBytes,
        proof,
        Buffer.from('bulletproof_payment')
      ]);
      const commitment = createHash('sha256').update(verificationData).digest();

      await program.methods
        .createZkPayRequest(reqId, Array.from(commitment), proof, new anchor.BN(minAmount), new anchor.BN(maxAmount), Array.from(ephemeralPubkey))
        .accounts({
          payRequest: reqPDA,
          escrow: escPDA,
          receiver: receiver.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([receiver])
        .rpc();

      // Settle payment
      const payProof = createHash('sha256').update(Buffer.from(amt.toString())).update(Buffer.from(i.toString())).digest();
      await program.methods
        .settleZkPayment(new anchor.BN(amt), payProof)
        .accounts({
          payRequest: reqPDA,
          escrow: escPDA,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([payer])
        .rpc();

      // Verify settlement
      const account = await program.account.zkPayRequest.fetch(reqPDA);
      expect(account.isSettled).to.be.true;
      expect(account.settledAmount.toNumber()).to.equal(amt);
    }
  });
});