import type {Env} from './security';

/**
 * D1 batches execute transactionally: a failed UPDATE CHECK or FK violation
 * rolls back the order, stock reservation and line-item inserts together.
 *
 * We cannot rely on SQLite CREATE TRIGGER in migrations because D1's remote
 * statement splitter may reject valid trigger bodies with SQLITE_ERROR 7500.
 */
export interface ReservableProduct {
 id: string;
 name: string;
 store_id: string;
 price_minor: number;
 quantity: number;
 supplier_id?: string|null;
}

/** All statements must be included in the SAME env.DB.batch as order creation. */
export function reserveStockStatements(
 env:Env,orderId:string,products:ReservableProduct[]
):D1PreparedStatement[] {
 return products.flatMap(product=>[
  // Force a CHECK(stock >= 0) violation when a concurrent order consumed stock,
  // or when the store, price, currency or published state changed.
  // A missing product is then rejected by order_items' foreign key.
  env.DB.prepare(`UPDATE products
    SET stock=CASE WHEN store_id=? AND status='published' AND currency='GBP'
      AND price_minor=? AND stock>=? THEN stock-? ELSE -1 END,
      updated_at=datetime('now')
    WHERE id=?`)
   .bind(product.store_id,product.price_minor,product.quantity,product.quantity,product.id),
  env.DB.prepare(`INSERT INTO order_items
    (id,order_id,product_id,product_name,quantity,unit_price_minor,supplier_id)
    VALUES(?,?,?,?,?,?,?)`)
   .bind(crypto.randomUUID(),orderId,product.id,product.name,product.quantity,product.price_minor,product.supplier_id||null)
 ]);
}

/**
 * Idempotent compensation for unpaid/expired checkouts.
 * All three statements MUST remain in one D1 batch, so simultaneous retries
 * cannot credit stock twice. Never release an order after Stripe confirms paid.
 */
export async function cancelUnpaid(env:Env,orderId:string):Promise<void>{
 await env.DB.batch([
  env.DB.prepare(`UPDATE orders SET status='cancelled',updated_at=datetime('now')
    WHERE id=? AND status='pending_payment'`).bind(orderId),
  env.DB.prepare(`UPDATE products
    SET stock=stock+COALESCE((
      SELECT SUM(i.quantity) FROM order_items i
      WHERE i.order_id=? AND i.product_id=products.id
    ),0),updated_at=datetime('now')
    WHERE id IN (SELECT product_id FROM order_items WHERE order_id=?)
      AND EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id=? AND o.status='cancelled' AND o.reservation_released=0
      )`).bind(orderId,orderId,orderId),
  env.DB.prepare(`UPDATE orders SET reservation_released=1,updated_at=datetime('now')
    WHERE id=? AND status='cancelled' AND reservation_released=0`).bind(orderId)
 ]);
}
