// Tipos de dominio compartidos entre servidor y cliente.

export const ROLES = ["MOZO", "COCINA", "CAJA", "SUPERVISOR", "ADMIN", "DUENO"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  MOZO: "Mozo",
  COCINA: "Cocina",
  CAJA: "Caja",
  SUPERVISOR: "Supervisor",
  ADMIN: "Administrador",
  DUENO: "Dueño",
};

export interface User {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  roles: Role[];
  active: boolean;
  failedAttempts: number;
  lockedUntil?: string;
  mustChangePassword?: boolean;
  createdAt: string;
}

export type PublicUser = Omit<User, "passwordHash" | "failedAttempts" | "lockedUntil">;

export interface Session {
  id: string; // hash sha256 del token
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string;
}

export interface PasswordResetRequest {
  id: string;
  identifier: string;
  userId?: string;
  createdAt: string;
  status: "pendiente" | "resuelta" | "descartada";
  resolvedBy?: string;
  resolvedAt?: string;
}

// ---------- Mesas ----------
export type TableShape = "cuadrada" | "redonda" | "rectangular";
export type TableStatus = "libre" | "ocupada" | "reservada";

export interface Sector {
  id: string;
  name: string;
  order: number;
  active: boolean;
}

export interface BarTable {
  id: string;
  code: string;
  capacity: number;
  shape: TableShape;
  sectorId: string;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  active: boolean;
  status: TableStatus;
  groupId?: string;
  waiterId?: string;
  currentOrderId?: string;
  reservationId?: string;
  createdAt: string;
}

export interface TableGroup {
  id: string;
  tableIds: string[];
  sectorId: string;
  createdAt: string;
  createdBy: string;
}

export interface WaiterAssignment {
  id: string;
  tableIds: string[];
  tableCodes: string;
  waiterId: string;
  waiterName: string;
  previousWaiterId?: string;
  kind: "asignacion" | "reasignacion";
  at: string;
  byUserId: string;
  byUserName: string;
}

// ---------- Catálogo ----------
export interface Category {
  id: string;
  name: string;
  order: number;
  active: boolean;
}

export interface RecipeLine {
  supplyId: string;
  qty: number;
}

export type BatchKind = "general" | "bebidas" | "entrada" | "principal" | "postre";
export const BATCH_KINDS: Record<BatchKind, string> = {
  general: "General",
  bebidas: "Bebidas",
  entrada: "Entrada",
  principal: "Plato principal",
  postre: "Postre",
};

export interface Product {
  id: string;
  name: string;
  price: number;
  categoryId: string;
  available: boolean;
  active: boolean;
  aliases: string[];
  recipe: RecipeLine[];
  description?: string;
}

// ---------- Pedidos ----------
export type BatchStatus = "borrador" | "pendiente" | "listo";
export type OrderStatus = "abierto" | "listo" | "cobrado" | "cancelado";

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  unitPrice: number;
  qty: number;
  notes: string;
  status: "activo" | "cancelado";
  prepared: boolean;
  createdAt: string;
}

/** Demora informada manualmente por cocina sobre una tanda pendiente. */
export interface BatchDelay {
  reason: string;
  minutes?: number; // demora estimada adicional
  at: string;
  byUserId: string;
  byUserName: string;
}

export interface Batch {
  id: string;
  number: number;
  kind: BatchKind;
  status: BatchStatus;
  createdAt: string;
  sentAt?: string;
  readyAt?: string;
  stockDeducted: boolean;
  items: OrderItem[];
  delay?: BatchDelay;
}

export interface Order {
  id: string;
  number: number;
  tableIds: string[];
  tableCodes: string;
  sectorId: string;
  groupId?: string;
  waiterId: string;
  guests: number;
  status: OrderStatus;
  openedAt: string;
  readyAt?: string;
  closedAt?: string;
  batches: Batch[];
  reservationId?: string;
  saleId?: string;
}

// ---------- Stock ----------
export type SupplyType = "unitario" | "granel";
export interface Supply {
  id: string;
  name: string;
  unit: string;
  category: string;
  type: SupplyType;
  minStock: number;
  stock: number;
  lastCost: number;
  active: boolean;
}

export interface Lot {
  id: string;
  supplyId: string;
  code: string;
  qty: number;
  expiresAt: string; // YYYY-MM-DD
  createdAt: string;
  active: boolean;
}

export type StockMovementType = "compra" | "venta" | "ajuste" | "conteo" | "anulacion";
export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  compra: "Entrada por compra",
  venta: "Salida por venta",
  ajuste: "Ajuste manual",
  conteo: "Conteo de cierre",
  anulacion: "Reintegro por anulación",
};

export interface StockMovement {
  id: string;
  seq: number; // orden estable entre movimientos del mismo instante
  supplyId: string;
  supplyName: string;
  at: string;
  type: StockMovementType;
  qty: number; // con signo
  balance: number;
  reason: string;
  refId?: string;
  userId: string;
  userName: string;
}

// ---------- Proveedores ----------
export interface Supplier {
  id: string;
  name: string;
  cuit: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  supplyIds: string[];
  categories: string[];
  notes: string;
  active: boolean;
  createdAt: string;
}

export type PurchaseStatus = "pendiente" | "confirmada" | "parcial" | "recibida" | "cancelada";

export interface PurchaseItem {
  supplyId: string;
  supplyName: string;
  unit: string;
  qty: number;
  unitCost: number;
  receivedQty: number;
}

export interface Reception {
  id: string;
  at: string;
  userId: string;
  userName: string;
  items: { supplyId: string; qty: number }[];
  missing: { supplyId: string; supplyName: string; qty: number }[];
  comment: string;
  partial: boolean;
}

export interface PurchaseOrder {
  id: string;
  number: number;
  supplierId: string;
  supplierName: string;
  status: PurchaseStatus;
  createdAt: string;
  createdBy: string;
  expectedAt?: string;
  items: PurchaseItem[];
  receptions: Reception[];
  notes: string;
  history: { at: string; status: PurchaseStatus; userName: string }[];
}

// ---------- Caja ----------
export interface PaymentMethod {
  id: string;
  name: string;
  active: boolean;
  isCash: boolean;
}

export type ShiftName = "Mañana" | "Tarde" | "Noche";

export interface CashShift {
  id: string;
  name: ShiftName;
  status: "abierta" | "cerrada";
  openedAt: string;
  openedBy: string;
  openedByName: string;
  openingAmount: number;
  closedAt?: string;
  closedBy?: string;
  closedByName?: string;
  expected?: Record<string, number>;
  counted?: Record<string, number>;
  expectedTotal?: number;
  countedTotal?: number;
  difference?: number;
  toleranceExceeded?: boolean;
  notes?: string;
}

export interface CashMovement {
  id: string;
  shiftId: string;
  type: "ingreso" | "egreso";
  methodId: string;
  amount: number;
  reason: string;
  at: string;
  userId: string;
  userName: string;
  refId?: string;
}

export interface SaleLine {
  productId: string;
  productName: string;
  categoryId: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface Sale {
  id: string;
  number: number;
  orderId: string;
  orderNumber: number;
  shiftId: string;
  at: string;
  userId: string;
  userName: string;
  waiterId: string;
  tableCodes: string;
  sectorId: string;
  guests: number;
  lines: SaleLine[];
  subtotal: number;
  discount?: { kind: "porcentaje" | "monto"; value: number; amount: number; reason: string };
  deposit: number;
  total: number;
  payments: { methodId: string; methodName: string; amount: number }[];
  change: number;
}

// ---------- Reservas ----------
export type ReservationStatus = "confirmada" | "sentada" | "cumplida" | "cancelada" | "no_show";
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  confirmada: "Confirmada",
  sentada: "En mesa",
  cumplida: "Cumplida",
  cancelada: "Cancelada",
  no_show: "No-show",
};

export interface Deposit {
  amount: number;
  methodId: string;
  methodName: string;
  at: string;
  status: "cobrada" | "aplicada" | "devuelta" | "perdida";
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  createdAt: string;
}

export interface Reservation {
  id: string;
  customerId: string;
  customerName: string;
  phone: string;
  email: string;
  at: string;
  durationMin: number;
  people: number;
  comments: string;
  tableIds: string[];
  tableCodes: string;
  status: ReservationStatus;
  deposit?: Deposit;
  createdAt: string;
  createdBy: string;
  cancelledAt?: string;
  internalReminderAt?: string;
  clientReminderAt?: string;
  orderId?: string;
}

export interface WaitlistEntry {
  id: string;
  name: string;
  phone: string;
  people: number;
  notes: string;
  createdAt: string;
  status: "esperando" | "sentado" | "cancelado";
  seatedAt?: string;
}

export interface OutboxMessage {
  id: string;
  channel: "email" | "whatsapp";
  to: string;
  subject: string;
  body: string;
  at: string;
  refId: string;
}

// ---------- Sistema ----------
export interface Notification {
  id: string;
  at: string;
  userId?: string;
  roles?: Role[];
  kind: "info" | "exito" | "alerta" | "peligro";
  title: string;
  body: string;
  link?: string;
  readBy: string[];
  key?: string; // evita duplicados de alertas automáticas
}

export interface AuditEntry {
  id: string;
  at: string;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId?: string;
  detail: string;
}

export interface Config {
  id: "config";
  barName: string;
  snapThreshold: number;
  kitchenDelayMinutes: number;
  cashTolerance: number;
  reservationCancelWindowMin: number;
  reservationHoldWindowMin: number;
  noShowToleranceMin: number;
  reservationDurationMin: number;
  reminderMinutesBefore: number;
  expiryAlertDays: number;
  defaultMinStock: number;
  lockoutAttempts: number;
  lockoutMinutes: number;
  sessionHours: number;
  paymentMethods: PaymentMethod[];
}
