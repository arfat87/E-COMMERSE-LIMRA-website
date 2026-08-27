import { readFileSync, writeFileSync } from 'fs';

let html = readFileSync('index.html', 'utf8');

const oldCart = `  <div id="cart-footer" class="hidden border-t p-4 space-y-3" style="border-color:var(--color-border)">
    <div class="space-y-2">
      <input type="text" id="order-customer-name" placeholder="Your name *" class="cart-input" required />
      <input type="tel" id="order-customer-phone" placeholder="Phone number *" class="cart-input" required />
      <textarea id="order-notes" placeholder="Special instructions (optional)" class="cart-input resize-none" rows="2"></textarea>
    </div>
    <div class="flex justify-between text-sm" style="color:var(--color-text-muted)">
      <span>Subtotal (<span id="cart-count-text">0</span> items)</span>
      <span>₹<span id="cart-subtotal">0</span></span>
    </div>
    <div class="flex justify-between font-bold text-base" style="color:var(--color-text-primary)">
      <span>Total</span>
      <span style="color:var(--color-accent)">₹<span id="cart-total">0</span></span>
    </div>
    <button id="place-order-btn" class="w-full flex items-center justify-center gap-2 text-white font-semibold py-3.5 rounded-xl transition-all hover:scale-[1.02]" style="background:var(--color-accent)">
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
      Place Order
    </button>
    <button id="order-whatsapp-btn" class="w-full flex items-center justify-center gap-2 text-white font-semibold py-2.5 rounded-xl text-sm transition-all" style="background:var(--color-green-wa)">
      Also send on WhatsApp
    </button>
    <p id="order-status-msg" class="text-xs text-center hidden"></p>
    <button id="cart-clear-btn" class="w-full text-sm py-1 transition-colors" style="color:var(--color-text-muted)">Clear Cart</button>
  </div>
</aside>`;

const newCart = `  <div id="cart-footer" class="hidden border-t p-4 space-y-3" style="border-color:var(--color-border)">
    <div class="space-y-2">
      <input type="text" id="order-customer-name" placeholder="Your name *" class="cart-input" required />
      <input type="tel" id="order-customer-phone" placeholder="Phone number *" class="cart-input" required />

      <!-- Delivery Type Toggle -->
      <div class="flex gap-2 pt-1">
        <button id="delivery-type-deliver" type="button" class="flex-1 py-2 rounded-xl text-xs font-semibold border-2 transition-all" style="border-color:var(--color-accent); background:var(--color-accent); color:#fff">
          🛵 Delivery
        </button>
        <button id="delivery-type-pickup" type="button" class="flex-1 py-2 rounded-xl text-xs font-semibold border-2 transition-all" style="border-color:var(--color-border); color:var(--color-text-muted); background:transparent">
          🏃 Self Pickup (Free)
        </button>
      </div>

      <!-- Delivery Address Fields -->
      <div id="delivery-address-block" class="space-y-2">
        <textarea id="order-address" placeholder="Delivery address *" class="cart-input resize-none" rows="2"></textarea>
        <div class="flex items-center gap-2">
          <input type="number" id="order-distance" placeholder="Distance from restaurant (km)" class="cart-input flex-1" min="0.1" max="50" step="0.1" />
          <div class="text-xs font-semibold px-3 py-2.5 rounded-xl shrink-0" style="background:var(--color-accent-bg); color:var(--color-accent); white-space:nowrap">
            ₹10/km
          </div>
        </div>
        <p class="text-xs flex items-center gap-1" style="color:var(--color-text-muted)">
          <svg class="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
          Restaurant: Nimtala, Alangiri, Egra
        </p>
      </div>

      <textarea id="order-notes" placeholder="Special instructions (optional)" class="cart-input resize-none" rows="2"></textarea>
    </div>

    <!-- Price Breakdown -->
    <div class="rounded-xl p-3 space-y-2" style="background:var(--color-off-white)">
      <div class="flex justify-between text-sm" style="color:var(--color-text-muted)">
        <span>Subtotal (<span id="cart-count-text">0</span> items)</span>
        <span>₹<span id="cart-subtotal">0</span></span>
      </div>
      <div id="delivery-charge-row" class="flex justify-between text-sm" style="color:var(--color-text-muted)">
        <span>🛵 Delivery (<span id="delivery-km-label">0</span> km × ₹10)</span>
        <span>₹<span id="cart-delivery-charge">0</span></span>
      </div>
      <div class="flex justify-between font-bold text-base pt-2 border-t" style="color:var(--color-text-primary); border-color:var(--color-border)">
        <span>Grand Total</span>
        <span style="color:var(--color-accent)">₹<span id="cart-total">0</span></span>
      </div>
    </div>

    <button id="place-order-btn" class="w-full flex items-center justify-center gap-2 text-white font-semibold py-3.5 rounded-xl transition-all hover:scale-[1.02]" style="background:var(--color-accent)">
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
      Place Order
    </button>
    <button id="order-whatsapp-btn" class="w-full flex items-center justify-center gap-2 text-white font-semibold py-2.5 rounded-xl text-sm transition-all" style="background:var(--color-green-wa)">
      Also send on WhatsApp
    </button>
    <p id="order-status-msg" class="text-xs text-center hidden"></p>
    <button id="cart-clear-btn" class="w-full text-sm py-1 transition-colors" style="color:var(--color-text-muted)">Clear Cart</button>
  </div>
</aside>`;

if (!html.includes(oldCart)) {
  console.error('Could not find cart footer block to replace!');
  process.exit(1);
}

html = html.replace(oldCart, newCart);
writeFileSync('index.html', html, 'utf8');
console.log('Cart footer updated with address + delivery charge fields.');
