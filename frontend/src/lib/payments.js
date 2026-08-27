import { insforge } from './insforge.js';

export const PaymentService = {
  /**
   * Updates an order's payment status to 'paid' or 'unpaid' via secure database RPC.
   * @param {string} orderId - Order UUID
   * @param {'paid'|'unpaid'} status - New payment status
   * @param {string} [notes] - Optional change log notes
   */
  async updatePaymentStatus(orderId, status, notes = null) {
    const { data, error } = await insforge.database.rpc('update_order_payment_status', {
      p_order_id: orderId,
      p_payment_status: status,
      p_notes: notes
    });

    if (error) {
      throw new Error(error.message || JSON.stringify(error));
    }
    return data;
  },

  /**
   * Mark order as paid.
   * @param {string} orderId 
   * @param {string} [notes] 
   */
  async markAsPaid(orderId, notes = null) {
    return this.updatePaymentStatus(orderId, 'paid', notes);
  },

  /**
   * Mark order as unpaid.
   * @param {string} orderId 
   * @param {string} [notes] 
   */
  async markAsUnpaid(orderId, notes = null) {
    return this.updatePaymentStatus(orderId, 'unpaid', notes);
  },

  /**
   * Retrieves payment audit logs for a specific order.
   * @param {string} orderId - Order UUID
   */
  async getPaymentHistory(orderId) {
    const { data, error } = await insforge.database
      .from('payment_history')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message || JSON.stringify(error));
    }
    return data;
  },

  /**
   * Triggers a customer notification broadcast via WebSocket (real-time).
   * @param {string} customerPhone - Customer phone number
   * @param {object} order - Order details
   */
  async sendPaymentNotification(customerPhone, order) {
    const cleanPhone = String(customerPhone).replace(/\D/g, '').slice(-10);
    if (cleanPhone.length >= 10) {
      await insforge.realtime.publish(`customer-notifications:${cleanPhone}`, 'notification_created', {
        title: 'Payment Received',
        message: `Your payment for Order #${order.order_number} has been successfully verified.`,
        order_id: order.id,
        type: 'payment_received',
        created_at: new Date().toISOString()
      });
    }
  },

  /**
   * Extensible interface for syncing future online payment gateways (Stripe, Razorpay, etc.)
   * @param {string} orderId - Order UUID
   * @param {string} gatewayName - Name of the gateway (e.g. 'Stripe')
   * @param {string} gatewayPaymentId - Transaction Reference ID
   */
  async syncGatewayPayment(orderId, gatewayName, gatewayPaymentId) {
    console.log(`[PaymentService] Syncing order ${orderId} with gateway ${gatewayName} (Payment ID: ${gatewayPaymentId})`);
    return this.markAsPaid(orderId, `Paid via ${gatewayName}. Transaction Ref: ${gatewayPaymentId}`);
  }
};
