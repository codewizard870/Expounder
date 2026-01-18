import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PaymentRequest } from "../target/types/payment_request";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("payment-request", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PaymentRequest as Program<PaymentRequest>;

  // Test accounts
  let receiver: anchor.web3.Keypair;
  let payer: anchor.web3.Keypair;
  let otherUser: anchor.web3.Keypair;

  // Request parameters
  const requestId = new anchor.BN(12345);
  const paymentAmount = 0.1 * LAMPORTS_PER_SOL; // 1 SOL

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
    // Transfer 1 SOL from payer to otherUser
    const transfer2receiverIx = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: receiver.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL, // 1 SOL
    });

    // Transfer 1 SOL from payer to otherUser
    const transfer2otherIx = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: otherUser.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL, // 1 SOL
    });

    const transferTx = new anchor.web3.Transaction().add(transfer2receiverIx).add(transfer2otherIx);
    await provider.connection.confirmTransaction(
      await provider.connection.sendTransaction(transferTx, [payer])
    );

    // Derive PDAs
    [payRequestPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pay_request"),
        receiver.publicKey.toBuffer(),
        requestId.toArrayLike(Buffer, "le", 8)
      ],
      program.programId
    );

    [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        receiver.publicKey.toBuffer(),
        requestId.toArrayLike(Buffer, "le", 8)
      ],
      program.programId
    );
  });

  it("Creates a payment request", async () => {
    const receiverBalanceBefore = await provider.connection.getBalance(receiver.publicKey);

    await program.methods
      .createPayRequest(requestId, new anchor.BN(paymentAmount))
      .accounts({
        payRequest: payRequestPDA,
        receiver: receiver.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([receiver])
      .rpc();

    // Verify the payment request was created
    const payRequestAccount = await program.account.payRequest.fetch(payRequestPDA);
    expect(payRequestAccount.receiver.toString()).to.equal(receiver.publicKey.toString());
    expect(payRequestAccount.requestId.toNumber()).to.equal(requestId.toNumber());
    expect(payRequestAccount.amount.toNumber()).to.equal(paymentAmount);
    expect(payRequestAccount.isSettled).to.be.false;
    expect(payRequestAccount.isSwept).to.be.false;

    // Check that some SOL was spent for rent
    const receiverBalanceAfter = await provider.connection.getBalance(receiver.publicKey);
    expect(receiverBalanceBefore).to.be.greaterThan(receiverBalanceAfter);
  });

  it("Settles payment to escrow", async () => {
    const payerBalanceBefore = await provider.connection.getBalance(payer.publicKey);
    const escrowBalanceBefore = await provider.connection.getBalance(escrowPDA);

    await program.methods
      .settlePayment()
      .accounts({
        payRequest: payRequestPDA,
        escrow: escrowPDA,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([payer])
      .rpc();

    // Verify payment was settled
    const payRequestAccount = await program.account.payRequest.fetch(payRequestPDA);
    expect(payRequestAccount.isSettled).to.be.true;
    expect(payRequestAccount.isSwept).to.be.false;

    // Verify funds are in escrow
    const escrowBalanceAfter = await provider.connection.getBalance(escrowPDA);
    expect(escrowBalanceAfter).to.equal(escrowBalanceBefore + paymentAmount);

    // Verify payer balance decreased
    const payerBalanceAfter = await provider.connection.getBalance(payer.publicKey);
    expect(payerBalanceBefore).to.be.greaterThan(payerBalanceAfter);
  });

  it("Fails to settle already settled payment", async () => {
    try {
      await program.methods
        .settlePayment()
        .accounts({
          payRequest: payRequestPDA,
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

  it("Fails to sweep funds with wrong receiver", async () => {
    try {
      await program.methods
        .sweepFunds()
        .accounts({
          payRequest: payRequestPDA,
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

  it("Sweeps funds to receiver", async () => {
    const receiverBalanceBefore = await provider.connection.getBalance(receiver.publicKey);
    const escrowBalanceBefore = await provider.connection.getBalance(escrowPDA);

    await program.methods
      .sweepFunds()
      .accounts({
        payRequest: payRequestPDA,
        receiver: receiver.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([receiver])
      .rpc();

    // Verify payment request account was closed (should fail to fetch)
    try {
      await program.account.payRequest.fetch(payRequestPDA);
      expect.fail("Payment request account should have been closed");
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

  it("Fails to sweep already swept payment", async () => {
    // Try to sweep the same payment again - should fail because account is closed
    try {
      await program.methods
        .sweepFunds()
        .accounts({
          payRequest: payRequestPDA,
          receiver: receiver.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([receiver])
        .rpc();
      expect.fail("Should have thrown error for closed account");
    } catch (error) {
      // Expected - account doesn't exist
    }
  });
});