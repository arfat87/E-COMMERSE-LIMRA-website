// LIMRA Admin — Stock Integration Module
// Seamlessly mounts the redesigned Stock UI with FIFO valuation and weekly statement

import './stock/stock.css';
import { initStockUI } from './stock/stock-ui.js';

export function initStockSummarySection() {
  initStockUI();
}

export function initStockSection() {
  initStockUI();
}
