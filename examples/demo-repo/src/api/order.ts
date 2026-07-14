// src/api/order.ts — DRIFT: imports stripe directly (violates no-stripe-direct-import)
import Stripe from 'stripe'; // ← THIS IS THE VIOLATION
import { PaymentService } from '../services/payment.js';

const stripe = new Stripe(process.env['STRIPE_KEY'] ?? '');

export async function createOrder(amount: number): Promise<string> {
  // Should use PaymentService, not stripe directly
  const intent = await stripe.paymentIntents.create({ amount, currency: 'usd' });
  return intent.id;
}
// trigger diff
import Stripe from 'stripe'; // new violation
