import { z } from "zod";
import type { Permission } from "@/lib/permissions";
import { activeItems, orderTotal } from "@/lib/calc";
import { type Ctx, fullName, getConfig } from "./core";
import * as admin from "./services/admin";
import * as auth from "./services/auth";
import * as cash from "./services/cash";
import * as kitchen from "./services/kitchen";
import * as orders from "./services/orders";
import * as reports from "./services/reports";
import * as res from "./services/reservations";
import * as stock from "./services/stock";
import * as sup from "./services/suppliers";
import * as tables from "./services/tables";

export interface Meta {
  sessionId: string;
}

interface Procedure<S extends z.ZodType, R> {
  perm: Permission | Permission[] | null; // null = cualquier usuario autenticado
  schema: S;
  handler: (ctx: Ctx, input: z.output<S>, meta: Meta) => R;
}

function proc<S extends z.ZodType, R>(perm: Procedure<S, R>["perm"], schema: S, handler: Procedure<S, R>["handler"]): Procedure<S, R> {
  return { perm, schema, handler };
}

const none = z.object({}).default({});
const id = z.object({ id: z.string() });
const range = reports.rangeSchema;

/** Vista consolidada del salón para el plano (RF-MSA-05, RF-MSA-13). */
function floorState(ctx: Ctx) {
  const cfg = getConfig(ctx.store);
  const users = new Map(ctx.store.all("users").map((u) => [u.id, fullName(u)]));
  const openOrders = ctx.store.find("orders", (o) => o.status === "abierto" || o.status === "listo");
  const now = ctx.now().getTime();
  const upcoming = ctx.store.find(
    "reservations",
    (r) => r.status === "confirmada" && new Date(r.at).getTime() > now - 3600_000 && new Date(r.at).getTime() < now + 24 * 3600_000,
  );
  return {
    sectors: tables.listSectors(ctx),
    tables: tables.listTables(ctx).map((t) => ({ ...t, waiterName: t.waiterId ? users.get(t.waiterId) : undefined })),
    groups: ctx.store.all("groups"),
    orders: openOrders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      guests: o.guests,
      openedAt: o.openedAt,
      total: orderTotal(o),
      pending: o.batches.filter((b) => b.status === "pendiente" && activeItems(b).length > 0).length,
      ready: o.batches.filter((b) => b.status === "listo" && activeItems(b).length > 0).length,
      draftItems: o.batches.filter((b) => b.status === "borrador").reduce((a, b) => a + activeItems(b).length, 0),
      waiterId: o.waiterId,
    })),
    reservations: upcoming.map((r) => ({ id: r.id, at: r.at, customerName: r.customerName, people: r.people, tableIds: r.tableIds, comments: r.comments })),
    snapThreshold: cfg.snapThreshold,
  };
}

export const procedures = {
  // ---------- Sesión ----------
  "auth.me": proc(null, none, (ctx, _i, meta) => auth.me(ctx, meta.sessionId)),
  "auth.changePassword": proc(null, z.object({ current: z.string(), next: z.string() }), (ctx, i) => auth.changeOwnPassword(ctx, i)),
  "auth.sessions": proc(null, none, (ctx, _i, meta) => auth.mySessions(ctx, meta.sessionId)),
  "auth.revokeSession": proc(null, z.object({ id: z.string().optional(), allOthers: z.boolean().optional() }), (ctx, i, meta) => auth.revokeSession(ctx, i, meta.sessionId)),
  "notifications.list": proc(null, none, (ctx) => admin.myNotifications(ctx)),
  "notifications.markRead": proc(null, z.object({ ids: z.array(z.string()).optional() }), (ctx, i) => admin.markNotificationsRead(ctx, i)),
  "staff.list": proc(null, z.object({ role: z.enum(["MOZO", "COCINA", "CAJA", "SUPERVISOR", "ADMIN", "DUENO"]).optional() }), (ctx, i) => auth.listStaff(ctx, i.role)),
  "config.get": proc(null, none, (ctx) => getConfig(ctx.store)),

  // ---------- Usuarios ----------
  "users.list": proc("usuarios.gestionar", none, (ctx) => auth.listUsers(ctx)),
  "users.create": proc("usuarios.gestionar", auth.userSchema, (ctx, i) => auth.createUser(ctx, i)),
  "users.update": proc("usuarios.gestionar", auth.userSchema.extend({ id: z.string() }), (ctx, i) => auth.updateUser(ctx, i)),
  "users.resetPassword": proc("usuarios.gestionar", z.object({ id: z.string(), password: z.string(), requestId: z.string().optional() }), (ctx, i) => auth.adminResetPassword(ctx, i)),
  "users.unlock": proc("usuarios.gestionar", id, (ctx, i) => auth.unlockUser(ctx, i.id)),
  "users.resetRequests": proc("usuarios.gestionar", none, (ctx) => auth.listResetRequests(ctx)),
  "users.dismissResetRequest": proc("usuarios.gestionar", id, (ctx, i) => auth.dismissResetRequest(ctx, i.id)),

  // ---------- Mesas y plano ----------
  "floor.state": proc("mesas.ver", none, (ctx) => floorState(ctx)),
  "sectors.list": proc(null, z.object({ includeInactive: z.boolean().optional() }), (ctx, i) => tables.listSectors(ctx, i.includeInactive)),
  "sectors.save": proc("mesas.gestionar", z.object({ id: z.string().optional(), name: z.string(), order: z.number().optional() }), (ctx, i) => tables.saveSector(ctx, i)),
  "sectors.deactivate": proc("mesas.gestionar", id, (ctx, i) => tables.deactivateSector(ctx, i.id)),
  "tables.list": proc(["mesas.ver", "reservas.ver"], z.object({ sectorId: z.string().optional(), status: z.string().optional(), minCapacity: z.number().optional() }), (ctx, i) => tables.listTables(ctx, i)),
  "tables.create": proc("mesas.gestionar", tables.tableSchema.extend({ x: z.number().optional(), y: z.number().optional() }), (ctx, i) => tables.createTable(ctx, i)),
  "tables.update": proc("mesas.gestionar", tables.tableSchema.extend({ id: z.string() }), (ctx, i) => tables.updateTable(ctx, i)),
  "tables.delete": proc("mesas.gestionar", id, (ctx, i) => tables.deleteTable(ctx, i.id)),
  "tables.move": proc("mesas.gestionar", z.object({ id: z.string(), x: z.number(), y: z.number(), join: z.boolean().optional() }), (ctx, i) => tables.moveTable(ctx, i)),
  "tables.split": proc(["mesas.gestionar", "mesas.operar"], z.object({ groupId: z.string() }), (ctx, i) => tables.splitGroup(ctx, i.groupId)),
  "tables.setStatus": proc("mesas.operar", z.object({ id: z.string(), status: z.enum(["libre", "reservada"]) }), (ctx, i) => tables.setTableStatus(ctx, i)),
  "tables.reassign": proc("mesas.operar", z.object({ tableId: z.string(), waiterId: z.string() }), (ctx, i) => tables.reassignWaiter(ctx, i)),
  "tables.assignments": proc("mesas.ver", z.object({ tableId: z.string().optional(), limit: z.number().optional() }), (ctx, i) => tables.assignmentHistory(ctx, i)),
  "tables.generate": proc("config.gestionar", z.object({ sectorId: z.string(), count: z.number().int(), capacity: z.number().int().min(1), shape: z.enum(["cuadrada", "redonda", "rectangular"]), prefix: z.string().max(4) }), (ctx, i) => tables.generateLayout(ctx, i)),

  // ---------- Pedidos ----------
  "orders.open": proc("pedidos.operar", orders.openOrderSchema, (ctx, i) => orders.openOrder(ctx, i)),
  "orders.get": proc("pedidos.ver", id, (ctx, i) => orders.getOrder(ctx, i.id)),
  "orders.list": proc("pedidos.ver", z.object({ tableId: z.string().optional(), status: z.string().optional(), active: z.boolean().optional(), waiterId: z.string().optional(), limit: z.number().optional() }), (ctx, i) => orders.listOrders(ctx, i)),
  "orders.createBatch": proc("pedidos.operar", z.object({ orderId: z.string(), kind: z.enum(["general", "bebidas", "entrada", "principal", "postre"]) }), (ctx, i) => orders.createBatch(ctx, i)),
  "orders.setBatchKind": proc("pedidos.operar", z.object({ orderId: z.string(), batchId: z.string(), kind: z.enum(["general", "bebidas", "entrada", "principal", "postre"]) }), (ctx, i) => orders.setBatchKind(ctx, i)),
  "orders.addItem": proc("pedidos.operar", orders.addItemSchema, (ctx, i) => orders.addItem(ctx, i)),
  "orders.updateItem": proc("pedidos.operar", orders.updateItemSchema, (ctx, i) => orders.updateItem(ctx, i)),
  "orders.cancelItem": proc("pedidos.operar", z.object({ orderId: z.string(), itemId: z.string(), kitchenConfirmed: z.boolean().optional(), reason: z.string().optional() }), (ctx, i) => orders.cancelItem(ctx, i)),
  "orders.sendBatch": proc("pedidos.operar", z.object({ orderId: z.string(), batchId: z.string() }), (ctx, i) => orders.sendBatch(ctx, i)),
  "orders.cancel": proc("pedidos.operar", z.object({ orderId: z.string(), reason: z.string().min(3, "Indique el motivo") }), (ctx, i) => orders.cancelOrder(ctx, i)),
  "orders.setGuests": proc("pedidos.operar", z.object({ orderId: z.string(), guests: z.number().int() }), (ctx, i) => orders.setGuests(ctx, i)),
  "products.forOrder": proc("pedidos.ver", none, (ctx) => admin.listProducts(ctx).filter((p) => p.active)),

  // ---------- Cocina ----------
  "kitchen.queue": proc("cocina.operar", none, (ctx) => kitchen.kitchenQueue(ctx)),
  "kitchen.toggleItem": proc("cocina.operar", z.object({ orderId: z.string(), batchId: z.string(), itemId: z.string() }), (ctx, i) => kitchen.toggleItemPrepared(ctx, i)),
  "kitchen.ready": proc("cocina.operar", z.object({ orderId: z.string(), batchId: z.string() }), (ctx, i) => kitchen.markBatchReady(ctx, i)),

  // ---------- Caja ----------
  "cash.current": proc("caja.operar", none, (ctx) => {
    const s = cash.currentShift(ctx);
    return s ? cash.shiftSummary(ctx, s.id) : null;
  }),
  "cash.open": proc("caja.operar", cash.openShiftSchema, (ctx, i) => cash.openShift(ctx, i)),
  "cash.close": proc("caja.operar", cash.closeShiftSchema, (ctx, i) => cash.closeShift(ctx, i)),
  "cash.movement": proc("caja.operar", cash.movementSchema, (ctx, i) => cash.addMovement(ctx, i)),
  "cash.chargeable": proc("caja.operar", none, (ctx) => cash.chargeableOrders(ctx)),
  "cash.charge": proc("caja.operar", cash.chargeSchema, (ctx, i) => cash.charge(ctx, i)),
  "cash.sale": proc(["caja.operar", "reportes.ver"], id, (ctx, i) => cash.getSale(ctx, i.id)),
  "cash.shifts": proc(["caja.operar", "reportes.ver"], z.object({ limit: z.number().optional() }), (ctx, i) => cash.listShifts(ctx, i)),
  "cash.shiftDetail": proc(["caja.operar", "reportes.ver"], id, (ctx, i) => cash.shiftSummary(ctx, i.id)),

  // ---------- Stock ----------
  "stock.supplies": proc(["stock.ver", "proveedores.gestionar", "catalogo.gestionar"], z.object({ includeInactive: z.boolean().optional() }), (ctx, i) => stock.listSupplies(ctx, i)),
  "stock.createSupply": proc("stock.gestionar", stock.supplySchema.extend({ initialStock: z.number().min(0).optional() }), (ctx, i) => stock.createSupply(ctx, i)),
  "stock.updateSupply": proc("stock.gestionar", stock.supplySchema.extend({ id: z.string() }), (ctx, i) => stock.updateSupply(ctx, i)),
  "stock.deactivateSupply": proc("stock.gestionar", id, (ctx, i) => stock.deactivateSupply(ctx, i.id)),
  "stock.adjust": proc("stock.gestionar", stock.adjustSchema, (ctx, i) => stock.adjustStock(ctx, i)),
  "stock.dayCount": proc("stock.gestionar", stock.countSchema, (ctx, i) => stock.registerDayCount(ctx, i)),
  "stock.addLot": proc("stock.gestionar", stock.lotSchema, (ctx, i) => stock.addLot(ctx, i)),
  "stock.closeLot": proc("stock.gestionar", id, (ctx, i) => stock.closeLot(ctx, i.id)),
  "stock.lots": proc("stock.ver", none, (ctx) => stock.listLots(ctx)),
  "stock.alerts": proc("stock.ver", none, (ctx) => stock.stockAlerts(ctx)),
  "stock.kardex": proc("stock.ver", z.object({ supplyId: z.string().optional(), type: z.enum(["compra", "venta", "ajuste", "conteo", "anulacion"]).optional(), limit: z.number().optional() }), (ctx, i) => stock.kardex(ctx, i)),

  // ---------- Proveedores ----------
  "suppliers.list": proc("proveedores.gestionar", z.object({ q: z.string().optional(), includeInactive: z.boolean().optional() }), (ctx, i) => sup.listSuppliers(ctx, i)),
  "suppliers.create": proc("proveedores.gestionar", sup.supplierSchema, (ctx, i) => sup.createSupplier(ctx, i)),
  "suppliers.update": proc("proveedores.gestionar", sup.supplierSchema.extend({ id: z.string() }), (ctx, i) => sup.updateSupplier(ctx, i)),
  "suppliers.setActive": proc("proveedores.gestionar", z.object({ id: z.string(), active: z.boolean() }), (ctx, i) => sup.setSupplierActive(ctx, i)),
  "purchases.list": proc("proveedores.gestionar", z.object({ supplierId: z.string().optional(), status: z.string().optional() }), (ctx, i) => sup.listPurchases(ctx, i)),
  "purchases.create": proc("proveedores.gestionar", sup.purchaseSchema, (ctx, i) => sup.createPurchase(ctx, i)),
  "purchases.setStatus": proc("proveedores.gestionar", z.object({ id: z.string(), status: z.enum(["confirmada", "cancelada"]) }), (ctx, i) => sup.setPurchaseStatus(ctx, i)),
  "purchases.receive": proc("proveedores.gestionar", sup.receiveSchema, (ctx, i) => sup.receivePurchase(ctx, i)),
  "purchases.history": proc("proveedores.gestionar", z.object({ supplierId: z.string().optional(), supplyId: z.string().optional() }), (ctx, i) => sup.purchaseHistory(ctx, i)),

  // ---------- Reservas ----------
  "reservations.list": proc("reservas.ver", z.object({ from: z.string(), to: z.string(), status: z.string().optional() }), (ctx, i) => res.listReservations(ctx, i)),
  "reservations.create": proc("reservas.gestionar", res.reservationSchema, (ctx, i) => res.createReservation(ctx, i)),
  "reservations.update": proc("reservas.gestionar", res.updateReservationSchema, (ctx, i) => res.updateReservation(ctx, i)),
  "reservations.cancel": proc("reservas.gestionar", z.object({ id: z.string(), reason: z.string().optional() }), (ctx, i) => res.cancelReservation(ctx, i)),
  "reservations.seat": proc(["reservas.gestionar", "pedidos.operar"], z.object({ id: z.string(), waiterId: z.string().optional() }), (ctx, i) => res.seatReservation(ctx, i)),
  "reservations.noShow": proc("reservas.gestionar", id, (ctx, i) => res.markNoShow(ctx, i.id)),
  "reservations.deposit": proc("reservas.gestionar", z.object({ id: z.string(), amount: z.number(), methodId: z.string() }), (ctx, i) => res.registerDeposit(ctx, i)),
  "reservations.remind": proc("reservas.gestionar", id, (ctx, i) => res.sendClientReminder(ctx, i.id)),
  "reservations.customers": proc("reservas.ver", z.object({ q: z.string().optional() }), (ctx, i) => res.customerHistory(ctx, i)),
  "reservations.outbox": proc("reservas.gestionar", none, (ctx) => res.listOutbox(ctx)),
  "waitlist.list": proc("reservas.ver", none, (ctx) => res.listWaitlist(ctx)),
  "waitlist.add": proc(["reservas.ver", "mesas.operar"], res.waitlistSchema, (ctx, i) => res.addWaitlist(ctx, i)),
  "waitlist.seat": proc(["pedidos.operar"], z.object({ id: z.string(), tableId: z.string(), waiterId: z.string().optional() }), (ctx, i) => res.seatWaitlist(ctx, i)),
  "waitlist.cancel": proc(["reservas.ver", "mesas.operar"], id, (ctx, i) => res.cancelWaitlist(ctx, i.id)),

  // ---------- Reportes ----------
  "reports.dashboard": proc("dashboard.ver", none, (ctx) => reports.dashboard(ctx)),
  "reports.sales": proc("reportes.ver", range, (ctx, i) => reports.salesReport(ctx, i)),
  "reports.compare": proc("reportes.ver", z.object({ a: range, b: range }), (ctx, i) => reports.comparePeriods(ctx, i)),
  "reports.ranking": proc("reportes.ver", range, (ctx, i) => reports.productRanking(ctx, i)),
  "reports.stock": proc("reportes.ver", range, (ctx, i) => reports.stockConsumption(ctx, i)),
  "reports.cash": proc("reportes.ver", range, (ctx, i) => reports.cashReport(ctx, i)),
  "reports.waiters": proc("reportes.ver", range, (ctx, i) => reports.waiterReport(ctx, i)),
  "reports.kitchen": proc("reportes.ver", range, (ctx, i) => reports.kitchenReport(ctx, i)),
  "reports.reservations": proc("reportes.ver", range, (ctx, i) => reports.reservationReport(ctx, i)),

  // ---------- Catálogo y administración ----------
  "categories.list": proc(null, z.object({ includeInactive: z.boolean().optional() }), (ctx, i) => admin.listCategories(ctx, i.includeInactive)),
  "categories.save": proc("catalogo.gestionar", z.object({ id: z.string().optional(), name: z.string() }), (ctx, i) => admin.saveCategory(ctx, i)),
  "categories.setActive": proc("catalogo.gestionar", z.object({ id: z.string(), active: z.boolean() }), (ctx, i) => admin.setCategoryActive(ctx, i)),
  "categories.reorder": proc("catalogo.gestionar", z.object({ ids: z.array(z.string()) }), (ctx, i) => admin.reorderCategories(ctx, i.ids)),
  "products.list": proc(["catalogo.gestionar", "reportes.ver", "pedidos.ver"], z.object({ includeInactive: z.boolean().optional() }), (ctx, i) => admin.listProducts(ctx, i)),
  "products.create": proc("catalogo.gestionar", admin.productSchema, (ctx, i) => admin.createProduct(ctx, i)),
  "products.update": proc("catalogo.gestionar", admin.productSchema.extend({ id: z.string() }), (ctx, i) => admin.updateProduct(ctx, i)),
  "products.setActive": proc("catalogo.gestionar", z.object({ id: z.string(), active: z.boolean() }), (ctx, i) => admin.setProductActive(ctx, i)),
  "products.setAvailable": proc(["catalogo.gestionar", "cocina.operar"], z.object({ id: z.string(), available: z.boolean() }), (ctx, i) => admin.toggleAvailability(ctx, i)),
  "config.update": proc("config.gestionar", admin.configSchema, (ctx, i) => admin.updateConfig(ctx, i)),
  "audit.list": proc("auditoria.ver", z.object({ q: z.string().optional(), entity: z.string().optional(), limit: z.number().optional() }), (ctx, i) => admin.listAudit(ctx, i)),
};

export type Procedures = typeof procedures;
export type ProcName = keyof Procedures;
export type ProcInput<P extends ProcName> = z.input<Procedures[P]["schema"]>;
export type ProcOutput<P extends ProcName> = ReturnType<Procedures[P]["handler"]>;
