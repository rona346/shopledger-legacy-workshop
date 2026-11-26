var test = require('node:test');
var assert = require('node:assert/strict');

var invoice = require('../lib/invoice');
var orders = require('../lib/orders');
var pricing = require('../lib/pricing');
var reports = require('../lib/reports');

// This helper deliberately uses only an in-memory order collection.  It mirrors
// the totals passed from routes/orders.js into lib/orders.js without using store.
function createBilledOrder(items, coupon) {
  var totals = pricing.computeTotals(items, coupon);
  var db = { orders: [], nextOrderId: 1 };

  return orders.add(db, {
    customer: 'In-memory customer',
    items: items,
    coupon: coupon,
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  });
}

test('invoice uses the billed HSN GST rate and reconciles with the order ledger', function () {
  var order = createBilledOrder([{
    id: 1,
    name: 'Rice',
    hsn: '1006',
    price: 100,
    qty: 1
  }], '');
  var figures = invoice.computeInvoiceFigures(order);
  var reconciliation = reports.getGstReconciliation({ orders: [order] });

  // The order total is what routes/orders.js stores and therefore bills.
  assert.deepEqual({
    subtotal: order.subtotal,
    discount: order.discount,
    tax: order.tax,
    total: order.total
  }, {
    subtotal: 100,
    discount: 0,
    tax: 5,
    total: 105
  });

  // The invoice must use the same HSN GST calculation stored on the order.
  assert.deepEqual({
    subtotal: figures.subtotal,
    discount: figures.discount,
    tax: figures.tax,
    cgst: figures.cgst,
    sgst: figures.sgst,
    total: figures.total,
    rowGstPercent: figures.rows[0].gstPercent
  }, {
    subtotal: 100,
    discount: 0,
    tax: 5,
    cgst: 2.5,
    sgst: 2.5,
    total: 105,
    rowGstPercent: 5
  });
  assert.deepEqual(reconciliation, {
    totalChecked: 1,
    mismatchCount: 0,
    totalDelta: 0,
    rows: [{
      orderId: 1,
      date: order.date,
      customer: 'In-memory customer',
      coupon: '',
      ledgerSubtotal: 100,
      ledgerDiscount: 0,
      ledgerTax: 5,
      ledgerTotal: 105,
      invoiceDiscount: 0,
      invoiceTax: 5,
      invoiceTotal: 105,
      delta: 0,
      matched: true
    }]
  });
});

test('printable invoice displays the billed total without a reconciliation warning', function () {
  var order = createBilledOrder([{
    id: 1,
    name: 'Rice',
    hsn: '1006',
    price: 100,
    qty: 1
  }], '');
  var html = invoice.render(order);

  assert.match(html, /Invoice Total<\/td><td class="r">₹105\.00/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('SAVE10 invoice applies the billed cap before tax', function () {
  var order = createBilledOrder([{
    id: 2,
    name: 'GST-rated item',
    gstRate: 5,
    price: 2000,
    qty: 1
  }], 'SAVE10');
  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual({
    discount: order.discount,
    tax: order.tax,
    total: order.total
  }, {
    discount: 150,
    tax: 92.5,
    total: 1942.5
  });
  assert.deepEqual({
    discount: figures.discount,
    tax: figures.tax,
    cgst: figures.cgst,
    sgst: figures.sgst,
    total: figures.total
  }, {
    discount: 150,
    tax: 92.5,
    cgst: 46.25,
    sgst: 46.25,
    total: 1942.5
  });
});

test('FLAT50 invoice taxes the post-discount amount', function () {
  var order = createBilledOrder([{
    id: 3,
    name: 'GST-rated item',
    gstRate: 18,
    price: 1000,
    qty: 1
  }], 'FLAT50');
  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual({
    discount: order.discount,
    tax: order.tax,
    total: order.total
  }, {
    discount: 50,
    tax: 171,
    total: 1121
  });
  assert.deepEqual({
    discount: figures.discount,
    tax: figures.tax,
    total: figures.total
  }, {
    discount: 50,
    tax: 171,
    total: 1121
  });
});
