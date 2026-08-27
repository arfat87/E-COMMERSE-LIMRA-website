import { insforge } from './insforge.js';
import { sendEmailNotification } from './email-service.js';

export const NotificationService = {
  /**
   * Creates a notification in the database (Admin operation).
   * @param {string} customerPhone - Customer 10-digit phone number
   * @param {string} orderId - Order UUID
   * @param {string} title - Notification title
   * @param {string} message - Notification content
   * @param {string} type - Notification type
   */
  async createNotification(customerPhone, orderId, title, message, type) {
    const { data, error } = await insforge.database.rpc('create_notification', {
      p_customer_phone: String(customerPhone).trim(),
      p_order_id: orderId,
      p_title: title,
      p_message: message,
      p_type: type
    });
    if (error) throw new Error(error.message || JSON.stringify(error));
    return data;
  },

  /**
   * Sends an email notification to the customer.
   * @param {string} toEmail - Recipient email
   * @param {string} subject - Email subject
   * @param {string} htmlContent - HTML email content
   * @param {object} templateParams - Optional EmailJS params
   */
  async sendEmail(toEmail, subject, htmlContent, templateParams = {}) {
    return await sendEmailNotification(toEmail, subject, htmlContent, templateParams);
  },

  /**
   * Sends an SMS notification (Prepared stub for plug-and-play integrations).
   * @param {string} phone - Customer phone number
   * @param {string} message - SMS message content
   */
  async sendSMS(phone, message) {
    console.log(`[NotificationService SMS Ready] Mock SMS to +91 ${phone}: "${message}"`);
    // Future integrations (e.g., Twilio, Plivo, MSG91) can be placed here.
    return { success: true, provider: 'mock-sms', phone, message };
  },

  /**
   * Sends a WhatsApp notification (Prepared stub for plug-and-play integrations).
   * @param {string} phone - Customer phone number
   * @param {string} message - WhatsApp template/content message
   */
  async sendWhatsApp(phone, message) {
    console.log(`[NotificationService WhatsApp Ready] Mock WhatsApp to +91 ${phone}: "${message}"`);
    // Future WhatsApp Business API integrations can be placed here.
    return { success: true, provider: 'mock-whatsapp', phone, message };
  },

  /**
   * Marks a specific notification as read.
   * @param {string} notificationId - Notification UUID
   * @param {string} phone - Customer phone number
   */
  async markAsRead(notificationId, phone) {
    const { data, error } = await insforge.database.rpc('mark_notification_as_read', {
      p_notification_id: notificationId,
      p_phone: String(phone).trim()
    });
    if (error) throw new Error(error.message || JSON.stringify(error));
    return data;
  },

  /**
   * Marks all notifications for a customer as read.
   * @param {string} phone - Customer phone number
   */
  async markAllAsRead(phone) {
    const { data, error } = await insforge.database.rpc('mark_all_notifications_as_read', {
      p_phone: String(phone).trim()
    });
    if (error) throw new Error(error.message || JSON.stringify(error));
    return data;
  },

  /**
   * Retrieves notifications history for a customer.
   * @param {string} phone - Customer phone number
   */
  async getUserNotifications(phone) {
    const { data, error } = await insforge.database.rpc('get_customer_notifications', {
      p_phone: String(phone).trim()
    });
    if (error) throw new Error(error.message || JSON.stringify(error));
    
    // Normalize RPC response format
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    return [data];
  },

  /**
   * Retrieves unread notifications count for a customer.
   * @param {string} phone - Customer phone number
   */
  async getUnreadCount(phone) {
    const { data, error } = await insforge.database.rpc('get_customer_unread_count', {
      p_phone: String(phone).trim()
    });
    if (error) throw new Error(error.message || JSON.stringify(error));
    return Number(data || 0);
  }
};
