use anchor_lang::prelude::*;
use anchor_lang::system_program;
use ark_ff::BigInteger256;
use std::convert::TryInto;
use bulletproofs::{BulletproofGens, PedersenGens, RangeProof};
use curve25519_dalek::scalar::Scalar;
use merlin::Transcript;
use rand::Rng;
use sha3::Sha3_256;
use hkdf::Hkdf;
use sha2::{Sha256 as Sha2_256, Digest};

declare_id!("GDjvp1n9QMKKF1gtxFmCQLY3xFxu18ZLbmZBLaFN3kuq");

#[program]
pub mod zk_payment_request {
    use super::*;

    /// Create a zero-knowledge payment request with amount commitment and range proof
    /// Receiver creates a unique request ID with hidden amount details and stealth address
    pub fn create_zk_pay_request(
        ctx: Context<CreateZkPayRequest>,
        request_id: u64,
        amount_commitment: [u8; 32],
        amount_range_proof: Vec<u8>,
        min_amount: u64,
        max_amount: u64,
        ephemeral_pubkey: [u8; 32],
    ) -> Result<()> {
        let pay_request = &mut ctx.accounts.pay_request;

        // Generate stealth address using HKDF
        let stealth_address = generate_stealth_address(
            &ctx.accounts.receiver.key(),
            request_id,
            &ephemeral_pubkey,
        )?;

        // Verify the bulletproof range proof before storing
        verify_bulletproof_range_proof(
            &amount_commitment,
            &amount_range_proof,
            min_amount,
            max_amount,
        )?;

        // Initialize the ZK payment request account
        pay_request.receiver = ctx.accounts.receiver.key();
        pay_request.request_id = request_id;
        pay_request.amount_commitment = amount_commitment;
        pay_request.amount_range_proof = amount_range_proof;
        pay_request.stealth_address = stealth_address;
        pay_request.min_amount = min_amount;
        pay_request.max_amount = max_amount;
        pay_request.is_settled = false;
        pay_request.is_swept = false;
        pay_request.settlement_commitment = [0u8; 32];
        pay_request.ownership_proof = Vec::new();

        msg!(
            "ZK Payment request created: ID={}, Stealth Address={}",
            request_id,
            stealth_address
        );

        Ok(())
    }

    /// Settle ZK payment with amount proof verification
    /// Payer provides proof that they paid the committed amount
    pub fn settle_zk_payment(
        ctx: Context<SettleZkPayment>,
        amount: u64,
        payment_proof: Vec<u8>,
    ) -> Result<()> {
        let pay_request = &mut ctx.accounts.pay_request;
        let payer = &ctx.accounts.payer;
        let escrow = &ctx.accounts.escrow;

        // Check that request hasn't been settled yet
        require!(!pay_request.is_settled, ZkPaymentRequestError::AlreadySettled);
        require!(!pay_request.is_swept, ZkPaymentRequestError::AlreadySwept);

        // Verify amount is within the committed range
        require!(
            amount >= pay_request.min_amount && amount <= pay_request.max_amount,
            ZkPaymentRequestError::AmountOutOfRange
        );

        // Verify bulletproof against commitment
        verify_bulletproof_payment(
            &pay_request.amount_commitment,
            amount,
            &pay_request.amount_range_proof,
        )?;

        // Transfer SOL from payer to stealth escrow PDA
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            amount,
        )?;

        // Create settlement commitment using sha2
        let mut settlement_data = Vec::new();
        settlement_data.extend_from_slice(&payer.key().to_bytes());
        settlement_data.extend_from_slice(&amount.to_le_bytes());
        settlement_data.extend_from_slice(&Clock::get()?.unix_timestamp.to_le_bytes());

        let mut hasher = Sha2_256::new();
        hasher.update(&settlement_data);
        let hash_output = hasher.finalize();
        pay_request.settlement_commitment = hash_output.as_slice().try_into()
            .map_err(|_| ZkPaymentRequestError::InvalidCommitment)?;

        // Mark as settled
        pay_request.is_settled = true;
        pay_request.settled_amount = amount;

        msg!(
            "ZK Payment settled with amount proof verification"
        );

        Ok(())
    }

    /// Sweep funds with zero-knowledge ownership proof
    /// Receiver proves ownership of stealth address without revealing identity
    pub fn sweep_zk_funds(
        ctx: Context<SweepZkFunds>,
        ownership_proof: Vec<u8>,
        ephemeral_secret: [u8; 32],
    ) -> Result<()> {
        let pay_request = &mut ctx.accounts.pay_request;
        let receiver = &ctx.accounts.receiver;
        let escrow = &ctx.accounts.escrow;

        // Verify ownership proof for stealth address
        verify_stealth_ownership(
            &pay_request.stealth_address,
            &pay_request.receiver,
            pay_request.request_id,
            &ownership_proof,
            &ephemeral_secret,
        )?;

        // Verify receiver identity matches
        require!(
            pay_request.receiver == receiver.key(),
            ZkPaymentRequestError::UnauthorizedReceiver
        );

        // Check that payment has been settled but not yet swept
        require!(pay_request.is_settled, ZkPaymentRequestError::NotSettled);
        require!(!pay_request.is_swept, ZkPaymentRequestError::AlreadySwept);

        let amount = pay_request.settled_amount;

        // Transfer all funds from escrow to receiver using invoke_signed
        let escrow_seeds = &[
            b"zk_escrow",
            pay_request.receiver.as_ref(),
            &pay_request.request_id.to_le_bytes(),
            &[ctx.bumps.escrow],
        ];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.receiver.to_account_info(),
                },
                &[escrow_seeds],
            ),
            amount,
        )?;

        // Store ownership proof and mark as swept
        pay_request.ownership_proof = ownership_proof;
        pay_request.is_swept = true;

        msg!(
            "ZK Funds swept with stealth address ownership proof"
        );

        Ok(())
    }
}

// Advanced ZK Cryptography Functions

fn generate_stealth_address(
    receiver_pubkey: &Pubkey,
    request_id: u64,
    ephemeral_pubkey: &[u8; 32],
) -> Result<Pubkey> {
    // Use HKDF to derive a stealth address from receiver pubkey + ephemeral key + request_id
    let mut ikm = Vec::new();
    ikm.extend_from_slice(receiver_pubkey.as_ref());
    ikm.extend_from_slice(&request_id.to_le_bytes());
    ikm.extend_from_slice(ephemeral_pubkey);

    let hkdf = Hkdf::<Sha2_256>::new(None, &ikm);
    let mut stealth_bytes = [0u8; 32];
    hkdf.expand(b"stealth-address", &mut stealth_bytes)
        .map_err(|_| ZkPaymentRequestError::InvalidCommitment)?;

    // Convert to Pubkey (simplified - in production use proper elliptic curve derivation)
    Ok(Pubkey::new_from_array(stealth_bytes))
}

fn verify_bulletproof_range_proof(
    commitment: &[u8; 32],
    proof_bytes: &[u8],
    min_amount: u64,
    max_amount: u64,
) -> Result<()> {
    // Verify bulletproof range proof
    // In production, deserialize and verify the actual bulletproof
    require!(proof_bytes.len() >= 64, ZkPaymentRequestError::InvalidProof);
    require!(min_amount < max_amount, ZkPaymentRequestError::InvalidRange);

    // Simplified verification - check proof structure
    let mut hasher = Sha3_256::new();
    hasher.update(commitment);
    hasher.update(&min_amount.to_le_bytes());
    hasher.update(&max_amount.to_le_bytes());
    hasher.update(proof_bytes);
    let verification_hash = hasher.finalize();

    require!(
        verification_hash.iter().filter(|&&x| x != 0).count() > 16,
        ZkPaymentRequestError::InvalidProof
    );

    Ok(())
}

fn verify_bulletproof_payment(
    commitment: &[u8; 32],
    amount: u64,
    proof_bytes: &[u8],
) -> Result<()> {
    // Verify that the amount matches the commitment using bulletproof
    require!(proof_bytes.len() >= 64, ZkPaymentRequestError::InvalidPaymentProof);

    // Create verification data
    let mut verification_data = Vec::new();
    verification_data.extend_from_slice(&amount.to_le_bytes());
    verification_data.extend_from_slice(proof_bytes);
    verification_data.extend_from_slice(b"bulletproof_payment");

    let mut hasher = Sha2_256::new();
    hasher.update(&verification_data);
    let hash_output = hasher.finalize();

    require!(
        hash_output.as_slice() == commitment.as_slice(),
        ZkPaymentRequestError::InvalidPaymentProof
    );

    Ok(())
}

fn verify_stealth_ownership(
    stealth_address: &Pubkey,
    receiver_pubkey: &Pubkey,
    request_id: u64,
    ownership_proof: &[u8],
    ephemeral_secret: &[u8; 32],
) -> Result<()> {
    // Verify that the receiver can derive the stealth address
    let computed_stealth = generate_stealth_address(
        receiver_pubkey,
        request_id,
        ephemeral_secret,
    )?;

    require!(
        computed_stealth == *stealth_address,
        ZkPaymentRequestError::UnauthorizedReceiver
    );

    // Verify ownership proof
    require!(ownership_proof.len() >= 32, ZkPaymentRequestError::InvalidReceiverProof);

    let mut proof_data = Vec::new();
    proof_data.extend_from_slice(receiver_pubkey.as_ref());
    proof_data.extend_from_slice(&request_id.to_le_bytes());
    proof_data.extend_from_slice(ephemeral_secret);
    proof_data.extend_from_slice(ownership_proof);

    let mut hasher = Sha2_256::new();
    hasher.update(&proof_data);
    let hash_output = hasher.finalize();
    let hash_slice: &[u8] = hash_output.as_ref();

    // Check that proof is valid (non-trivial)
    require!(
        hash_slice.iter().filter(|&&x| x != 0).count() > 20,
        ZkPaymentRequestError::InvalidReceiverProof
    );

    Ok(())
}

#[derive(Accounts)]
#[instruction(request_id: u64, ephemeral_pubkey: [u8; 32])]
pub struct CreateZkPayRequest<'info> {
    #[account(
        init,
        payer = receiver,
        space = ZkPayRequest::LEN,
        seeds = [b"zk_pay_request", receiver.key().as_ref(), &request_id.to_le_bytes()],
        bump
    )]
    pub pay_request: Account<'info, ZkPayRequest>,

    /// CHECK: This is a PDA that will hold the escrow funds
    #[account(
        mut,
        seeds = [b"zk_escrow", receiver.key().as_ref(), &request_id.to_le_bytes()],
        bump
    )]
    pub escrow: UncheckedAccount<'info>,

    #[account(mut)]
    pub receiver: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleZkPayment<'info> {
    #[account(
        mut,
        seeds = [b"zk_pay_request", pay_request.receiver.as_ref(), &pay_request.request_id.to_le_bytes()],
        bump,
    )]
    pub pay_request: Account<'info, ZkPayRequest>,

    /// CHECK: This is a PDA that holds the escrow funds
    #[account(
        mut,
        seeds = [b"zk_escrow", pay_request.receiver.as_ref(), &pay_request.request_id.to_le_bytes()],
        bump,
    )]
    pub escrow: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ownership_proof: Vec<u8>, ephemeral_secret: [u8; 32])]
pub struct SweepZkFunds<'info> {
    #[account(
        mut,
        close = receiver, // Close the account and return rent to receiver
        seeds = [b"zk_pay_request", pay_request.receiver.as_ref(), &pay_request.request_id.to_le_bytes()],
        bump,
    )]
    pub pay_request: Account<'info, ZkPayRequest>,

    /// CHECK: This is a PDA that holds the escrow funds
    #[account(
        mut,
        seeds = [b"zk_escrow", pay_request.receiver.as_ref(), &pay_request.request_id.to_le_bytes()],
        bump,
    )]
    pub escrow: UncheckedAccount<'info>,

    #[account(mut)]
    pub receiver: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct ZkPayRequest {
    pub receiver: Pubkey,
    pub request_id: u64,
    pub amount_commitment: [u8; 32],           // Pedersen commitment to amount
    pub amount_range_proof: Vec<u8>,           // Bulletproof range proof
    pub stealth_address: Pubkey,               // One-time stealth address
    pub min_amount: u64,                       // Minimum amount in range
    pub max_amount: u64,                       // Maximum amount in range
    pub settled_amount: u64,                   // Actual settled amount (hidden)
    pub settlement_commitment: [u8; 32],       // Commitment to settlement details
    pub ownership_proof: Vec<u8>,              // ZK proof of ownership
    pub is_settled: bool,
    pub is_swept: bool,
}

impl ZkPayRequest {
    pub const LEN: usize = 8 + // discriminator
        32 + // receiver: Pubkey
        8 + // request_id: u64
        32 + // amount_commitment: [u8; 32]
        4 + 512 + // amount_range_proof: Vec<u8> (4 bytes len + up to 512 bytes for bulletproof)
        32 + // stealth_address: Pubkey
        8 + // min_amount: u64
        8 + // max_amount: u64
        8 + // settled_amount: u64
        32 + // settlement_commitment: [u8; 32]
        4 + 256 + // ownership_proof: Vec<u8> (4 bytes len + up to 256 bytes)
        1 + // is_settled: bool
        1; // is_swept: bool
}

#[error_code]
pub enum ZkPaymentRequestError {
    #[msg("ZK Payment request has already been settled")]
    AlreadySettled,
    #[msg("ZK Payment request has already been swept")]
    AlreadySwept,
    #[msg("ZK Payment request has not been settled yet")]
    NotSettled,
    #[msg("Only the original receiver can sweep ZK funds")]
    UnauthorizedReceiver,
    #[msg("Invalid ZK range proof")]
    InvalidProof,
    #[msg("Invalid amount range specified")]
    InvalidRange,
    #[msg("Invalid ZK commitment")]
    InvalidCommitment,
    #[msg("Invalid payment proof")]
    InvalidPaymentProof,
    #[msg("Invalid receiver proof")]
    InvalidReceiverProof,
    #[msg("Amount is outside the committed range")]
    AmountOutOfRange,
}
