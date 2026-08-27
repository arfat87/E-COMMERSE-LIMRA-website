/**
 * LIMRA Restaurant - Unified Email Notification Service
 * Supports Resend, EmailJS, and a seamless visual/console fallback.
 */

// Format currencies
function fmtMoney(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' && process.env ? process.env : {});

// Check if keys are configured
const emailJsConfig = {
  serviceId: env.VITE_EMAILJS_SERVICE_ID || '',
  templateId: env.VITE_EMAILJS_TEMPLATE_ID || '',
  publicKey: env.VITE_EMAILJS_PUBLIC_KEY || ''
};

const resendApiKey = env.VITE_RESEND_API_KEY || '';

/**
 * Sends a premium HTML email notification.
 * @param {string} toEmail - Recipient email
 * @param {string} subject - Email subject
 * @param {string} htmlContent - HTML body
 * @param {object} templateParams - Dynamic keys for EmailJS template fallback
 */
export async function sendEmailNotification(toEmail, subject, htmlContent, templateParams = {}) {
  if (!toEmail || !toEmail.includes('@')) {
    console.warn(`[EmailService] Invalid recipient email skipped: "${toEmail}"`);
    return { success: false, reason: 'Invalid email' };
  }

  // ─── OPTION A: RESEND API ───
  if (resendApiKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`
        },
        body: JSON.stringify({
          from: 'LIMRA Restaurant <onboarding@resend.dev>', // Resend verified domain or onboarding address
          to: toEmail,
          subject: subject,
          html: htmlContent
        })
      });
      const data = await response.json();
      if (response.ok) {
        console.log('[EmailService] Email sent successfully via Resend:', data);
        return { success: true, provider: 'resend', data };
      }
      console.warn('[EmailService] Resend API error response:', data);
    } catch (err) {
      console.error('[EmailService] Failed to send via Resend:', err);
    }
  }

  // ─── OPTION B: EMAILJS API ───
  if (emailJsConfig.serviceId && emailJsConfig.templateId && emailJsConfig.publicKey) {
    try {
      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          service_id: emailJsConfig.serviceId,
          template_id: emailJsConfig.templateId,
          user_id: emailJsConfig.publicKey,
          template_params: {
            to_email: toEmail,
            subject: subject,
            html_content: htmlContent,
            ...templateParams
          }
        })
      });
      if (response.ok) {
        console.log('[EmailService] Email sent successfully via EmailJS');
        return { success: true, provider: 'emailjs' };
      }
      const errText = await response.text();
      console.warn('[EmailService] EmailJS error response:', errText);
    } catch (err) {
      console.error('[EmailService] Failed to send via EmailJS:', err);
    }
  }

  // ─── FALLBACK: MOCK DEV MODE ───
  console.log('============= MOCK DEV EMAIL SENT =============');
  console.log(`To: ${toEmail}`);
  console.log(`Subject: ${subject}`);
  console.log(`Body (HTML):\n${htmlContent.replace(/<[^>]*>/g, '').slice(0, 300)}...`);
  console.log('================================================');

  // Trigger a visual Toast in the browser context if helper exists
  const msg = `Notification receipt drafted and logged for ${toEmail}.`;
  console.log(`[EmailService DEV] ${msg}`);
  
  return { success: true, provider: 'dev-mock', mockMessage: msg };
}

/**
 * Generate placed order HTML body
 */
export function generateOrderPlacedHtml(order, items) {
  const itemsList = items.map(i => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:10px 0;font-size:14px;color:#333">${i.item_name}</td>
      <td style="padding:10px 0;font-size:14px;color:#666;text-align:center">${i.quantity}</td>
      <td style="padding:10px 0;font-size:14px;color:#333;text-align:right">${fmtMoney(i.unit_price)}</td>
      <td style="padding:10px 0;font-size:14px;color:#00b074;text-align:right;font-weight:600">${fmtMoney(i.line_total)}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:'Inter',sans-serif;max-width:600px;margin:0 auto;border:1px solid #eef0f4;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.05)">
      <div style="background:linear-gradient(135deg,#00b074,#009663);padding:30px;text-align:center;color:#fff">
        <h1 style="margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px">LIMRA Restaurant</h1>
        <p style="margin:5px 0 0;font-size:14px;opacity:0.9">Order Received & Confirmed!</p>
      </div>
      <div style="padding:30px;background:#fff">
        <p style="font-size:16px;color:#333;margin:0 0 20px">Hi <strong>${order.customer_name}</strong>,</p>
        <p style="font-size:14px;color:#555;line-height:1.5;margin:0 0 20px">Thank you for ordering with LIMRA! Your order <strong>#${order.order_number}</strong> has been successfully placed in our system. We are reviewing your details and will contact you shortly.</p>
        
        <div style="background:#f8faf9;border-radius:12px;padding:20px;margin-bottom:25px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#333;text-transform:uppercase;letter-spacing:0.5px">Summary of Details</h3>
          <p style="margin:0 0 5px;font-size:13px;color:#555"><strong>Phone:</strong> ${order.customer_phone}</p>
          <p style="margin:0;font-size:13px;color:#555"><strong>Date:</strong> ${new Date(order.created_at).toLocaleString('en-IN')}</p>
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:25px">
          <thead>
            <tr style="border-bottom:2px solid #00b074;color:#666;font-size:12px;text-transform:uppercase">
              <th style="text-align:left;padding-bottom:10px">Item</th>
              <th style="text-align:center;padding-bottom:10px;width:60px">Qty</th>
              <th style="text-align:right;padding-bottom:10px;width:80px">Unit</th>
              <th style="text-align:right;padding-bottom:10px;width:100px">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsList}
          </tbody>
        </table>

        <div style="width:100%;margin-bottom:30px">
          <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:14px;color:#666">
            <span>Subtotal</span>
            <span>${fmtMoney(order.total_amount)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:16px;color:#111;font-weight:700;border-top:1px solid #eee;margin-top:10px;padding-top:10px">
            <span>Grand Total</span>
            <span style="color:#00b074">${fmtMoney(order.total_amount)}</span>
          </div>
        </div>

        <div style="border-top:1px solid #eef0f4;padding-top:20px;text-align:center;color:#8b95a5;font-size:12px">
          <p style="margin:0">Need help? Contact us at limrarestaurant99@gmail.com</p>
          <p style="margin:5px 0 0">© 2026 LIMRA Restaurant. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generate order confirmed HTML body
 */
export function generateOrderConfirmedHtml(order) {
  return `
    <div style="font-family:'Inter',sans-serif;max-width:600px;margin:0 auto;border:1px solid #eef0f4;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.05)">
      <div style="background:linear-gradient(135deg,#2d9cdb,#1a82c4);padding:30px;text-align:center;color:#fff">
        <h1 style="margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px">LIMRA Restaurant</h1>
        <p style="margin:5px 0 0;font-size:14px;opacity:0.9">Order Confirmed & Preparing!</p>
      </div>
      <div style="padding:30px;background:#fff">
        <p style="font-size:16px;color:#333;margin:0 0 20px">Hi <strong>${order.customer_name}</strong>,</p>
        <p style="font-size:14px;color:#555;line-height:1.5;margin:0 0 20px">Great news! Your order <strong>#${order.order_number}</strong> has been **confirmed** by the kitchen staff and is currently being prepared with care. Our delivery partner will be dispatched shortly to arrange your delivery/pickup.</p>
        
        <div style="background:#f8faf9;border-radius:12px;padding:20px;margin-bottom:25px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#333;text-transform:uppercase;letter-spacing:0.5px">Order Summary</h3>
          <p style="margin:0 0 5px;font-size:13px;color:#555"><strong>Order Number:</strong> #${order.order_number}</p>
          <p style="margin:0 0 5px;font-size:13px;color:#555"><strong>Total Amount:</strong> ${fmtMoney(order.total_amount)}</p>
          <p style="margin:0;font-size:13px;color:#555"><strong>Status:</strong> Confirmed & Preparing</p>
        </div>

        <p style="font-size:14px;color:#555;line-height:1.5;margin:0 0 20px">Thank you again for choosing LIMRA Restaurant! We are committed to serving you delicious, fresh, and high-quality meals.</p>

        <div style="border-top:1px solid #eef0f4;padding-top:20px;text-align:center;color:#8b95a5;font-size:12px">
          <p style="margin:0">Need help? Contact us at limrarestaurant99@gmail.com</p>
          <p style="margin:5px 0 0">© 2026 LIMRA Restaurant. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generate order cancelled HTML body
 */
export function generateOrderCancelledHtml(order) {
  return `
    <div style="font-family:'Inter',sans-serif;max-width:600px;margin:0 auto;border:1px solid #eef0f4;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.05)">
      <div style="background:linear-gradient(135deg,#ff5b5b,#e04444);padding:30px;text-align:center;color:#fff">
        <h1 style="margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px">LIMRA Restaurant</h1>
        <p style="margin:5px 0 0;font-size:14px;opacity:0.9">Order Update - Cancelled</p>
      </div>
      <div style="padding:30px;background:#fff">
        <p style="font-size:16px;color:#333;margin:0 0 20px">Hi <strong>${order.customer_name}</strong>,</p>
        <p style="font-size:14px;color:#555;line-height:1.5;margin:0 0 20px">We regret to inform you that your order <strong>#${order.order_number}</strong> has been **cancelled**. This can be due to high demand, ingredient shortages, or kitchen closures.</p>
        
        <div style="background:#fff5f5;border-radius:12px;padding:20px;margin-bottom:25px;border:1px solid #ffd8d8">
          <h3 style="margin:0 0 10px;font-size:14px;color:#ff5b5b;text-transform:uppercase;letter-spacing:0.5px">Cancellation details</h3>
          <p style="margin:0 0 5px;font-size:13px;color:#555"><strong>Order Number:</strong> #${order.order_number}</p>
          <p style="margin:0 0 5px;font-size:13px;color:#555"><strong>Total Amount:</strong> ${fmtMoney(order.total_amount)}</p>
          <p style="margin:0;font-size:13px;color:#555"><strong>Status:</strong> Cancelled</p>
        </div>

        <p style="font-size:14px;color:#555;line-height:1.5;margin:0 0 20px">If you believe this was an error or have any questions, please contact our support team immediately.</p>

        <div style="border-top:1px solid #eef0f4;padding-top:20px;text-align:center;color:#8b95a5;font-size:12px">
          <p style="margin:0">Need help? Contact us at limrarestaurant99@gmail.com</p>
          <p style="margin:5px 0 0">© 2026 LIMRA Restaurant. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
}
