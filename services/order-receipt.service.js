/**
 * One authoritative receipt representation of a persisted order.
 *
 * The invoice PDF, the customer website and the customer mobile app all render this object,
 * so no client (and not the PDF either) re-derives totals. Figures come straight from the
 * stored order; the grand total is order.total — what the customer was actually charged.
 *
 * NOTE: this is an order receipt. A GST-compliant tax invoice additionally needs fields
 * Dabba Nation does not store today (HSN/SAC codes, place of supply, tax rates per line,
 * the supplier's GSTIN for every seller). See the report for the open business decisions.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

const PAYMENT_METHOD_LABELS = {
  cod: 'Cash on delivery',
  wallet: 'Wallet',
  subscription: 'Subscription balance',
  online: 'Online (UPI)',
  online_qr: 'Online (UPI QR)',
  upi: 'UPI',
  razorpay: 'Online (Razorpay)',
  stripe: 'Card',
};

/**
 * @param {object} order  Order document or lean object, ideally with userId and sellerId populated
 * @param {object} [invoice] Invoice record for this order, if one was generated
 */
function buildOrderReceipt(order, invoice = null) {
  const o = typeof order?.toObject === 'function' ? order.toObject() : order;
  const items = (o.items || [])
    .map((item) => {
      const quantity = num(item.quantity);
      const unitPrice = num(item.sellingPrice ?? item.price);
      return {
        menuItemId: item.menuItemId ? String(item.menuItemId) : null,
        name: item.name || 'Item',
        quantity,
        unitPrice: round2(unitPrice),
        lineTotal: round2(unitPrice * quantity),
      };
    })
    .filter((i) => i.quantity > 0);

  const foodGst = round2(num(o.foodCgst) + num(o.foodSgst) + num(o.foodIgst));
  const deliveryGst = round2(num(o.deliveryCgst) + num(o.deliverySgst) + num(o.deliveryIgst));
  const taxTotal = o.gstAmount != null ? round2(num(o.gstAmount)) : round2(foodGst + deliveryGst);

  const subtotal = round2(num(o.subtotal));
  const deliveryFee = round2(num(o.deliveryFee));
  const discount = round2(num(o.discount));
  const grandTotal = round2(num(o.total));
  const subscriptionCredit = round2(num(o.subscriptionAmountUsed));
  const amountDue = round2(o.payableAfterSubscription != null && o.subscriptionAmountUsed
    ? num(o.payableAfterSubscription)
    : grandTotal - subscriptionCredit);

  // What the charged components add up to (platform fee is recorded for settlement only and is
  // not part of the customer total, see services/gst-order.service.js)
  const componentsTotal = round2(subtotal + taxTotal + deliveryFee - discount);
  const itemsTotal = round2(items.reduce((s, i) => s + i.lineTotal, 0));

  const seller = o.sellerId && typeof o.sellerId === 'object' ? o.sellerId : {};
  const customer = o.userId && typeof o.userId === 'object' ? o.userId : {};
  const cleanId = (v) => (v && !['N/A', '0', 'undefined', 'null'].includes(String(v)) ? String(v) : null);

  return {
    documentType: 'order_receipt',
    currency: 'INR',
    orderId: String(o._id),
    orderNumber: o.orderNumber || null,
    invoiceNumber: invoice?.invoiceNumber || null,
    orderDate: o.createdAt ? new Date(o.createdAt).toISOString() : null,
    status: o.status,
    customer: {
      name: customer.name || null,
      phone: customer.phone || null,
      email: customer.email || null,
      deliveryAddress: o.deliveryAddress?.fullAddress
        || [o.deliveryAddress?.street, o.deliveryAddress?.city, o.deliveryAddress?.pincode].filter(Boolean).join(', ')
        || null,
    },
    seller: {
      id: seller._id ? String(seller._id) : (o.sellerId ? String(o.sellerId) : null),
      name: seller.businessName || null,
      type: seller.type || null,
      address: seller.address?.fullAddress
        || [seller.address?.street, seller.address?.city].filter(Boolean).join(', ')
        || null,
      gstNumber: cleanId(seller.gstNumber),
      fssaiLicense: cleanId(seller.fssaiLicense),
    },
    items,
    summary: {
      itemTotal: subtotal,
      foodGst,
      deliveryGst,
      taxTotal,
      deliveryFee,
      discount,
      grandTotal,
      subscriptionCredit,
      amountDue,
    },
    payment: {
      method: o.paymentMethod || null,
      methodLabel: PAYMENT_METHOD_LABELS[o.paymentMethod] || o.paymentMethod || null,
      status: o.paymentStatus || 'pending',
      reference: o.paymentId || o.paymentReference || null,
    },
    integrity: {
      // false would mean the stored order is internally inconsistent — surfaced, never hidden
      itemsMatchSubtotal: Math.abs(itemsTotal - subtotal) <= 0.01,
      componentsMatchTotal: Math.abs(componentsTotal - grandTotal) <= 0.01,
    },
  };
}

module.exports = { buildOrderReceipt, PAYMENT_METHOD_LABELS };
