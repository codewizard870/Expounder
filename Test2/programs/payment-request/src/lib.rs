use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("EKFkEussF5JC6yPEggdhG3ME3CRhrokYWxUQPckwksvo");

#[program]
pub mod payment_request {
    use super::*;

    /// Create a new payment request with PDA escrow
    /// Receiver creates a unique request ID and initializes escrow
    pub fn create_pay_request(
        ctx: Context<CreatePayRequest>,
        request_id: u64,
        amount: u64,
    ) -> Result<()> {
        let pay_request = &mut ctx.accounts.pay_request;

        // Initialize the payment request account
        pay_request.receiver = ctx.accounts.receiver.key();
        pay_request.request_id = request_id;
        pay_request.amount = amount;
        pay_request.is_settled = false;
        pay_request.is_swept = false;

        msg!(
            "Payment request created: ID={}, Amount={}, Receiver={}",
            request_id,
            amount,
            pay_request.receiver
        );

        Ok(())
    }

    /// Settle payment by transferring funds to escrow PDA
    /// Payer sends SOL to the escrow account
    pub fn settle_payment(ctx: Context<SettlePayment>) -> Result<()> {
        let pay_request = &mut ctx.accounts.pay_request;
        let payer = &ctx.accounts.payer;
        let escrow = &ctx.accounts.escrow;

        // Check that request hasn't been settled yet
        require!(!pay_request.is_settled, PaymentRequestError::AlreadySettled);
        require!(!pay_request.is_swept, PaymentRequestError::AlreadySwept);

        // Transfer SOL from payer to escrow PDA using system program
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            pay_request.amount,
        )?;

        // Mark as settled
        pay_request.is_settled = true;

        msg!(
            "Payment settled: {} lamports transferred to escrow",
            pay_request.amount
        );

        Ok(())
    }

    /// Sweep funds from escrow to receiver's wallet
    /// Only the original receiver can sweep the funds
    pub fn sweep_funds(ctx: Context<SweepFunds>) -> Result<()> {
        let pay_request = &mut ctx.accounts.pay_request;
        let receiver = &ctx.accounts.receiver;
        let escrow = &ctx.accounts.escrow;

        // Verify this is the correct receiver
        require!(
            pay_request.receiver == receiver.key(),
            PaymentRequestError::UnauthorizedReceiver
        );

        // Check that payment has been settled but not yet swept
        require!(pay_request.is_settled, PaymentRequestError::NotSettled);
        require!(!pay_request.is_swept, PaymentRequestError::AlreadySwept);

        let amount = pay_request.amount;

        // Transfer all funds from escrow to receiver using invoke_signed
        let escrow_seeds = &[
            b"escrow",
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

        // Mark as swept and close the escrow account
        pay_request.is_swept = true;

        msg!(
            "Funds swept: {} lamports transferred to receiver {}",
            amount,
            receiver.key()
        );

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(request_id: u64)]
pub struct CreatePayRequest<'info> {
    #[account(
        init,
        payer = receiver,
        space = PayRequest::LEN,
        seeds = [b"pay_request", receiver.key().as_ref(), &request_id.to_le_bytes()],
        bump
    )]
    pub pay_request: Account<'info, PayRequest>,

    /// CHECK: This is a PDA that will hold the escrow funds
    #[account(
        mut,
        seeds = [b"escrow", receiver.key().as_ref(), &request_id.to_le_bytes()],
        bump
    )]
    pub escrow: UncheckedAccount<'info>,

    #[account(mut)]
    pub receiver: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettlePayment<'info> {
    #[account(
        mut,
        seeds = [b"pay_request", pay_request.receiver.as_ref(), &pay_request.request_id.to_le_bytes()],
        bump,
    )]
    pub pay_request: Account<'info, PayRequest>,

    /// CHECK: This is a PDA that holds the escrow funds
    #[account(
        mut,
        seeds = [b"escrow", pay_request.receiver.as_ref(), &pay_request.request_id.to_le_bytes()],
        bump,
    )]
    pub escrow: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SweepFunds<'info> {
    #[account(
        mut,
        close = receiver, // Close the account and return rent to receiver
        seeds = [b"pay_request", pay_request.receiver.as_ref(), &pay_request.request_id.to_le_bytes()],
        bump,
    )]
    pub pay_request: Account<'info, PayRequest>,

    /// CHECK: This is a PDA that holds the escrow funds
    #[account(
        mut,
        seeds = [b"escrow", pay_request.receiver.as_ref(), &pay_request.request_id.to_le_bytes()],
        bump,
    )]
    pub escrow: UncheckedAccount<'info>,

    #[account(mut)]
    pub receiver: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct PayRequest {
    pub receiver: Pubkey,
    pub request_id: u64,
    pub amount: u64,
    pub is_settled: bool,
    pub is_swept: bool,
}

impl PayRequest {
    pub const LEN: usize = 8 + // discriminator
        32 + // receiver: Pubkey
        8 + // request_id: u64
        8 + // amount: u64
        1 + // is_settled: bool
        1; // is_swept: bool
}

#[error_code]
pub enum PaymentRequestError {
    #[msg("Payment request has already been settled")]
    AlreadySettled,
    #[msg("Payment request has already been swept")]
    AlreadySwept,
    #[msg("Payment request has not been settled yet")]
    NotSettled,
    #[msg("Only the original receiver can sweep funds")]
    UnauthorizedReceiver,
}
