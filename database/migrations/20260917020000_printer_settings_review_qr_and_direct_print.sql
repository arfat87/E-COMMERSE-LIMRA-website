-- Migration: Add Google Review QR, Direct Print, and Print Queue configurations to printer_settings
-- Created: 2026-09-17 02:00:00

ALTER TABLE IF EXISTS public.printer_settings
  ADD COLUMN IF NOT EXISTS bill_show_review_qr BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS bill_review_url TEXT DEFAULT 'https://g.page/r/CcrqEfWap5zfEBE/review',
  ADD COLUMN IF NOT EXISTS bill_review_heading TEXT DEFAULT 'LOVE YOUR EXPERIENCE?',
  ADD COLUMN IF NOT EXISTS bill_review_subtext TEXT DEFAULT 'Scan to leave us a Google Review',
  ADD COLUMN IF NOT EXISTS direct_print_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_print_on_settle BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS print_queue_retry_limit INTEGER DEFAULT 3;

-- Update default settings row if exists
UPDATE public.printer_settings
SET
  bill_show_review_qr = COALESCE(bill_show_review_qr, true),
  bill_review_url = COALESCE(bill_review_url, 'https://g.page/r/CcrqEfWap5zfEBE/review'),
  bill_review_heading = COALESCE(bill_review_heading, 'LOVE YOUR EXPERIENCE?'),
  bill_review_subtext = COALESCE(bill_review_subtext, 'Scan to leave us a Google Review'),
  direct_print_enabled = COALESCE(direct_print_enabled, true),
  auto_print_on_settle = COALESCE(auto_print_on_settle, true),
  print_queue_retry_limit = COALESCE(print_queue_retry_limit, 3)
WHERE id = 'default';
