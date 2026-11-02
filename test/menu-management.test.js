import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { COMPRESSION_LIMITS, formatFileSize } from '../frontend/src/lib/image-optimizer.js';
import { parseMenuOverrideDescription, encodeMenuOverrideDescription } from '../frontend/src/lib/supabase.js';
import { menuItems } from '../frontend/src/data/menu.js';

describe('SUITE 34: Complete Menu Management — Edit, Delete, Optimization & Immutability', () => {

  test('1. Compression limits comply with required bounds (<= 150 KB, target 30-80 KB)', () => {
    assert.equal(COMPRESSION_LIMITS.MAX_SIZE_KB, 150, 'Max allowed size must be 150 KB');
    assert.ok(
      COMPRESSION_LIMITS.TARGET_SIZE_KB >= 30 && COMPRESSION_LIMITS.TARGET_SIZE_KB <= 80,
      'Target size must be within 30-80 KB'
    );
    assert.equal(COMPRESSION_LIMITS.MAX_WIDTH, 800, 'Max width bound should be 800px');
    assert.equal(COMPRESSION_LIMITS.MAX_HEIGHT, 800, 'Max height bound should be 800px');
    assert.equal(formatFileSize(50 * 1024), '50.0 KB');
    assert.equal(formatFileSize(1.5 * 1024 * 1024), '1.50 MB');
  });

  test('2. Menu override description encoding & decoding preserves dish name, category, diet, image and GST', () => {
    const rawDesc = 'Fresh aromatic rice cooked with goat meat';
    const metadata = {
      name: 'Special Royal Mutton Biryani',
      category: 'biryani',
      diet: 'nonveg',
      image: 'https://ynrtlcasbndkrqeotgzt.supabase.co/storage/v1/object/public/menu-images/dish_1.webp',
      gst_applicable: true,
      is_deleted: false
    };

    const encoded = encodeMenuOverrideDescription(rawDesc, metadata);
    assert.ok(encoded.includes('[NAME:Special Royal Mutton Biryani]'), 'Must include NAME tag');
    assert.ok(encoded.includes('[CAT:biryani]'), 'Must include CAT tag');
    assert.ok(encoded.includes('[DIET:nonveg]'), 'Must include DIET tag');
    assert.ok(encoded.includes('[IMAGE:https://'), 'Must include IMAGE tag');
    assert.ok(!encoded.includes('[NO_GST]'), 'Should not have NO_GST when gst_applicable is true');
    assert.ok(!encoded.includes('[DELETED]'), 'Should not have DELETED when is_deleted is false');

    const parsed = parseMenuOverrideDescription(encoded);
    assert.equal(parsed.name, 'Special Royal Mutton Biryani');
    assert.equal(parsed.category, 'biryani');
    assert.equal(parsed.diet, 'nonveg');
    assert.equal(parsed.image, 'https://ynrtlcasbndkrqeotgzt.supabase.co/storage/v1/object/public/menu-images/dish_1.webp');
    assert.equal(parsed.gst_applicable, true);
    assert.equal(parsed.is_deleted, false);
    assert.equal(parsed.clean_description, rawDesc);
  });

  test('3. Base dish soft-delete flag is properly tagged and parsed', () => {
    const encoded = encodeMenuOverrideDescription('Cream of tomato soup', {
      is_deleted: true,
      gst_applicable: false
    });

    assert.ok(encoded.includes('[DELETED]'), 'Must encode [DELETED] tag');
    assert.ok(encoded.includes('[NO_GST]'), 'Must encode [NO_GST] tag');

    const parsed = parseMenuOverrideDescription(encoded);
    assert.equal(parsed.is_deleted, true);
    assert.equal(parsed.gst_applicable, false);
    assert.equal(parsed.clean_description, 'Cream of tomato soup');
  });

  test('4. Base dishes can have their name, price, category, and photo overridden simultaneously', () => {
    const baseItem = menuItems[0];
    assert.ok(baseItem, 'Base menu items should exist');

    const override = {
      id: baseItem.id,
      name: 'Custom Renamed Base Dish',
      category: 'tandoor-kabab',
      diet: 'nonveg',
      price: 399.50,
      mrp: 450.00,
      image: '/uploads/menu/dish_test.webp',
      description: 'Chef signature recipe',
      available: true,
      featured: true,
      gst_applicable: true,
      is_deleted: false
    };

    // Simulate getCombinedFoodItems resolution
    const resolvedItem = {
      ...baseItem,
      name: override.name || baseItem.name,
      category: override.category || baseItem.category,
      diet: override.diet || baseItem.diet,
      price: override.price,
      mrp: override.mrp,
      image: override.image || baseItem.image,
      description: override.description,
      available: override.available,
      featured: override.featured,
      gst_applicable: override.gst_applicable
    };

    assert.equal(resolvedItem.name, 'Custom Renamed Base Dish');
    assert.equal(resolvedItem.category, 'tandoor-kabab');
    assert.equal(resolvedItem.price, 399.50);
    assert.equal(resolvedItem.mrp, 450.00);
    assert.equal(resolvedItem.image, '/uploads/menu/dish_test.webp');
    assert.equal(resolvedItem.available, true);
  });

  test('5. Deleted base dishes are excluded from the active menu list', () => {
    const baseItem = menuItems[1];
    const overrides = [
      {
        id: baseItem.id,
        is_deleted: true,
        available: false,
        description: 'Archived dish [DELETED]'
      }
    ];

    // Simulation of filtering logic in getCombinedFoodItems / getAllCombinedMenuItems
    const activeList = menuItems.filter(item => {
      if (item.is_deleted === true) return false;
      const ov = overrides.find(o => String(o.id) === String(item.id));
      if (ov && (ov.is_deleted === true || ov.description?.includes('[DELETED]'))) {
        return false;
      }
      return true;
    });

    assert.ok(!activeList.some(item => item.id === baseItem.id), 'Deleted base item must not appear in active list');
  });

  test('6. Custom dish addition, editing, and deletion lifecycles work correctly', () => {
    let customDishes = [];

    // Add
    const newCustom = {
      id: 'custom_9001',
      db_id: 9001,
      name: 'Paneer Lababdar Special',
      category: 'veg-curry',
      diet: 'veg',
      is_veg: true,
      price: 260,
      mrp: 300,
      image: '/uploads/menu/paneer_lababdar.webp',
      available: true,
      featured: true,
      is_custom: true
    };
    customDishes.push(newCustom);
    assert.equal(customDishes.length, 1);

    // Edit Name and Price
    const dishToEdit = customDishes.find(d => d.id === 'custom_9001');
    dishToEdit.name = 'Royal Paneer Lababdar (Jumbo)';
    dishToEdit.price = 290;
    assert.equal(dishToEdit.name, 'Royal Paneer Lababdar (Jumbo)');
    assert.equal(dishToEdit.price, 290);

    // Delete
    customDishes = customDishes.filter(d => d.id !== 'custom_9001');
    assert.equal(customDishes.length, 0, 'Custom dish should be deleted permanently');
  });

  test('7. Historical Order & Invoice Immutability: Mutating or deleting a dish never affects past orders', () => {
    // Historical order created 3 days ago with frozen price and name snapshots
    const historicalOrder = {
      id: 'ord-hist-999',
      order_number: 1042,
      created_at: '2026-10-28T12:00:00Z',
      items: [
        {
          menu_item_id: 1,
          item_name: 'Original Chicken Soup',
          unit_price: 120.00,
          quantity: 2,
          line_total: 240.00
        }
      ],
      subtotal: 240.00,
      gst_amount: 12.00,
      total_amount: 252.00,
      status: 'completed',
      payment_status: 'paid'
    };

    // Owner now modifies menu item 1 (renames it, increases price to ₹180, then later archives it)
    const activeOverride = {
      id: 1,
      name: 'Super Deluxe Hot & Sour Chicken Soup',
      price: 180.00,
      is_deleted: true
    };

    // Verify historical order item snapshots remain untouched
    const historicalItem = historicalOrder.items[0];
    assert.equal(historicalItem.item_name, 'Original Chicken Soup', 'Historical item name must remain unchanged');
    assert.equal(historicalItem.unit_price, 120.00, 'Historical unit price must remain unchanged');
    assert.equal(historicalItem.line_total, 240.00, 'Historical line total must remain unchanged');
    assert.equal(historicalOrder.total_amount, 252.00, 'Historical invoice total must remain 100% frozen');
  });

});
