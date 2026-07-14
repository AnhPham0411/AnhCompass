// src/services/payment.ts — CORRECT: PaymentService wraps stripe
import Stripe from 'stripe';

export class PaymentService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(process.env['STRIPE_KEY'] ?? '');
  }

  async charge(amount: number, currency: string): Promise<string> {
    const intent = await this.stripe.paymentIntents.create({ amount, currency });
    return intent.id;
  }
}
