# LoyaltyOS — Instrucciones de Proyecto para Claude Cowork

> Plataforma open source de customer loyalty con soporte nativo para coaliciones de puntos (Puntos Apprecio) y sistema de puntos propio.

---

## Identidad del Proyecto

**Nombre:** LoyaltyOS  
**Repositorio:** `github.com/[org]/loyaltyos`  
**Licencia:** MIT  
**Stack principal:** Node.js (API) + React (Admin UI) + PostgreSQL + Redis  
**Inspiración:** OpenLoyalty.io  
**Diferenciador clave:** Conector nativo con sistemas de coalición de puntos externos (Puntos Apprecio), manteniendo un motor de puntos propio independiente.

---

## Visión del Producto

LoyaltyOS es una plataforma de fidelización open source diseñada para ser **simple de desplegar pero poderosa en operación**. Cualquier empresa — desde una PYME hasta una corporación — puede instalarla, conectar sus canales de venta y empezar a correr campañas de loyalty en menos de una hora.

### Pilares de diseño

1. **API-first**: Todo lo que hace el admin UI también está disponible via REST + GraphQL.
2. **Modular**: Cada subsistema (puntos, cupones, campañas, badges) es un módulo independiente que puede activarse o desactivarse.
3. **Coalition-ready**: Arquitectura preparada para conectar con sistemas externos de puntos como Puntos Apprecio sin romper el motor de puntos propio.
4. **Multi-tenant**: Soporta múltiples marcas/programas bajo una sola instalación.
5. **Event-driven**: Toda la lógica se dispara desde eventos (compra, visita, registro, cumpleaños, etc.).

---

## Arquitectura General

```
loyaltyos/
├── apps/
│   ├── api/              # REST + GraphQL API (Node.js / Fastify)
│   ├── admin/            # Admin UI (React + Vite)
│   └── widget/           # Embeddable loyalty widget (Web Component)
├── packages/
│   ├── core/             # Motor de puntos y reglas de negocio
│   ├── campaigns/        # Motor de campañas
│   ├── segments/         # Segmentación de clientes
│   ├── coupons/          # Gestión de cupones
│   ├── rewards/          # Catálogo de recompensas
│   ├── badges/           # Sistema de badges y gamificación
│   ├── coalition/        # Conector de coalición (Apprecio y otros)
│   └── notifications/    # Canales de notificación (email, push, SMS)
├── infra/
│   ├── docker/
│   └── k8s/
└── docs/
```

---

## Módulos del Sistema

### 1. Motor de Puntos (`packages/core`)

El corazón del sistema. Gestiona el ciclo de vida completo de los puntos propios del programa.

**Funcionalidades:**

- Acumulación de puntos por evento (compra, registro, referido, interacción)
- Reglas de multiplicadores (2x en fin de semana, 3x en categoría premium)
- Vencimiento de puntos configurable (rolling expiry o fixed date)
- Puntos pendientes vs confirmados (para flujos con devolución)
- Histórico de transacciones inmutable (ledger-style)
- Soporte multi-moneda de puntos (diferentes unidades por programa)

**Modelo de datos clave:**

```
PointAccount { id, memberId, programId, balance, pendingBalance }
PointTransaction { id, accountId, type, amount, source, expiresAt, metadata }
PointRule { id, programId, eventType, multiplier, conditions, startsAt, endsAt }
```

---

### 2. Motor de Campañas (`packages/campaigns`)

Crea campañas de incentivos con condiciones complejas sin escribir código.

**Tipos de campaña:**

- **Bonus Points**: Puntos extra por período, categoría o producto específico
- **Spend & Get**: Gasta X → gana Y (p.ej., compra $50.000 y gana 500 puntos)
- **Frequency**: Visita N veces en M días y gana bonus
- **Milestone**: Alcanza un nivel de gasto acumulado y desbloquea recompensa
- **Referral**: Trae un amigo y ambos ganan
- **Birthday/Anniversary**: Campaña automática en fecha especial
- **Flash Sale**: Campaña de ventana corta (horas/días)
- **Tier Upgrade Bonus**: Premio al subir de tier

**Atributos de campaña:**

- Fechas de vigencia (start/end)
- Segmentos objetivo (quién aplica)
- Canales de venta (online, físico, app)
- Límite de usos por cliente
- Presupuesto máximo de puntos
- Stackable o no con otras campañas
- A/B testing nativo (divide audiencia en variantes)

---

### 3. Segmentación de Clientes (`packages/segments`)

Define audiencias dinámicas o estáticas para campañas y comunicaciones.

**Tipos de segmento:**

- **Estáticos**: Lista manual de clientes (CSV import o selección manual)
- **Dinámicos**: Reglas que se recalculan en tiempo real

**Atributos para segmentar:**

- Saldo de puntos (rango)
- Tier de loyalty
- Últimos X días sin compra (win-back)
- Gasto total acumulado
- Categorías de productos compradas
- Ubicación geográfica
- Canal de adquisición
- Fecha de registro (antigüedad)
- Edad / género (si se capturó)
- Etiquetas personalizadas (custom tags)
- Comportamiento: abrió email, canjeó cupón, etc.

**Capacidades:**

- Intersección y unión de segmentos (AND / OR)
- Preview de tamaño del segmento en tiempo real
- Exportación de segmento a CSV
- Sincronización con CRM externo (HubSpot, Salesforce)

---

### 4. Gestión de Cupones (`packages/coupons`)

Sistema completo de generación, distribución y validación de cupones.

**Tipos de cupón:**

- Descuento porcentual (%)
- Descuento monto fijo ($)
- Producto gratis
- Envío gratis
- Puntos extra (se conecta al motor de puntos)
- Acceso a experiencia/evento

**Modos de código:**

- **Único**: Un código para todos los clientes (p.ej., SUMMER20)
- **Individual**: Un código único por cliente (generación masiva)
- **Limitado**: Primer N usos

**Configuraciones:**

- Fecha de vencimiento
- Uso único o múltiple por cliente
- Mínimo de compra para activar
- Categorías o productos aplicables
- Canales válidos (online/físico)
- Stackable con puntos: sí/no

**Distribución:**

- Por email (campaña de email)
- Por SMS
- Push notification
- API (para integrar en ecommerce)
- QR code generado automáticamente

---

### 5. Catálogo de Recompensas (`packages/rewards`)

Todo lo que los clientes pueden canjear con sus puntos.

**Tipos de recompensa:**

- Descuentos en compra futura
- Productos físicos (con integración a inventario)
- Gift cards (propias o de terceros)
- Experiencias (evento, servicio)
- Donaciones a causa social
- Transferencia a programa externo (Apprecio Coalition)

**Atributos:**

- Costo en puntos
- Stock disponible (si aplica)
- Imagen y descripción rica
- Disponibilidad por segmento o tier
- Validez del canje
- Partner externo (para recompensas de coalición)

**Catálogo UI:**

- Vista de vitrina para el cliente final
- Filtros por categoría, tipo, costo
- Favoritos y lista de deseos
- Historial de canjes

---

### 6. Sistema de Badges y Gamificación (`packages/badges`)

Reconocimientos visuales que impulsan engagement y comportamiento.

**Tipos de badge:**

- **Achievement**: Por haber hecho algo (primera compra, 10 canjes, etc.)
- **Status**: Por nivel alcanzado (Plata, Oro, Platino)
- **Temporal**: Por participar en campaña específica
- **Coleccionable**: Serie que se completa (ej: badges de temporada)
- **Social**: Por referir amigos o compartir

**Mecánicas:**

- Progress bar hacia el siguiente badge
- Notificación al desbloquear
- Galería pública de badges del cliente
- Badges exclusivos por tier

**Tiers de loyalty:**

- Configuración libre de N niveles
- Criterio de subida: puntos acumulados, gasto, visitas, combinación
- Beneficios por tier (puntos extra, acceso especial, cupones exclusivos)
- Downgrade automático opcional (por inactividad)

---

### 7. Conector de Coalición — Puntos Apprecio (`packages/coalition`)

Módulo que conecta LoyaltyOS con sistemas externos de coalición de puntos, con soporte nativo para **Puntos Apprecio**.

**Arquitectura del conector:**

```
CoalitionAdapter (interface genérica)
  └── ApprecioAdapter (implementación específica)
  └── AirMilesAdapter (ejemplo de extensión)
  └── CustomAdapter (plantilla para integraciones propias)
```

**Flujos soportados:**

#### Flujo 1: Acumular puntos en Apprecio desde LoyaltyOS

- Cliente compra en comercio adherido a LoyaltyOS
- LoyaltyOS acumula puntos propios del programa
- Opcionalmente, envía también puntos al saldo Apprecio del cliente (via API Apprecio)
- Doble acumulación: puntos propios + Puntos Apprecio

#### Flujo 2: Canjear puntos Apprecio en comercio LoyaltyOS

- Cliente elige pagar/canjear con sus Puntos Apprecio
- LoyaltyOS valida saldo disponible via API Apprecio
- Procesa el descuento y confirma el débito al sistema Apprecio
- Registra la transacción en el ledger local

#### Flujo 3: Convertir puntos propios a Puntos Apprecio

- Cliente solicita desde el portal convertir sus puntos acumulados
- LoyaltyOS debita puntos del saldo propio
- Acredita puntos en cuenta Apprecio (via API)
- Tasa de conversión configurable por el operador

**Configuración del conector:**

```yaml
coalition:
  provider: apprecio
  api_endpoint: https://api.puntos.apprecio.com/v1
  api_key: ${APPRECIO_API_KEY}
  merchant_id: ${APPRECIO_MERCHANT_ID}
  conversion_rate: 1.0 # 1 punto propio = 1 Punto Apprecio
  accumulation_enabled: true
  redemption_enabled: true
  conversion_enabled: true
  min_conversion_points: 500
```

**Interface genérica para nuevos conectores:**

```typescript
interface CoalitionAdapter {
  getBalance(memberId: string): Promise<number>;
  accumulate(memberId: string, points: number, txRef: string): Promise<TxResult>;
  redeem(memberId: string, points: number, txRef: string): Promise<TxResult>;
  convert(memberId: string, ownPoints: number): Promise<TxResult>;
  reverseTransaction(txRef: string): Promise<void>;
}
```

---

### 8. Notificaciones (`packages/notifications`)

Motor de comunicaciones multicanal integrado al ciclo de loyalty.

**Canales:**

- Email (Resend / SendGrid / SMTP propio)
- SMS (Twilio / AWS SNS)
- Push (FCM / APNs via OneSignal)
- In-app (widget embebido)
- Webhook (para integraciones custom)

**Triggers automáticos:**

- Puntos acumulados (resumen de transacción)
- Puntos por vencer (alerta 30/7 días antes)
- Badge desbloqueado
- Cupón asignado
- Tier upgrade/downgrade
- Recompensa canjeada
- Campaña flash activa para el segmento del cliente

**Template engine:**

- Plantillas en Handlebars
- Variables dinámicas: nombre, saldo, badge, cupón
- Preview en tiempo real desde el admin
- Soporte HTML y texto plano

---

## Admin UI — Pantallas Principales

### Dashboard Principal

- KPIs: miembros activos, puntos emitidos, puntos canjeados, ratio de canje, NPS estimado
- Gráfico de acumulación vs canje (30/90/365 días)
- Top campañas activas
- Alertas del sistema

### Gestión de Miembros

- Listado con filtros avanzados
- Perfil completo: saldo, historial de transacciones, badges, canjes, campañas activas
- Ajuste manual de puntos (con nota de auditoría obligatoria)
- Merge de cuentas duplicadas
- Exportación CSV/Excel

### Constructor de Campañas (Campaign Builder)

- Wizard paso a paso: tipo → audiencia → reglas → canales → fechas → revisión
- Vista previa del impacto estimado (N miembros elegibles, puntos proyectados)
- Activación programada

### Segmentos

- Creador de reglas visual (drag & drop conditions)
- Historial de versiones del segmento
- Uso del segmento en campañas activas

### Cupones

- Generador masivo de códigos únicos
- Tracking de uso en tiempo real
- Invalidación masiva de cupón

### Catálogo de Recompensas

- Gestión de ítems con imágenes
- Control de stock
- Historial de canjes

### Badges

- Editor visual de badges (upload SVG/PNG)
- Configuración de condiciones de desbloqueo
- Estadísticas de distribución

### Configuración de Coalition

- Panel de conexión con Apprecio (test de conectividad, tasa de conversión)
- Log de transacciones cross-system
- Reconciliación manual

### Configuración General

- Datos del programa (nombre, logo, moneda de puntos)
- Tiers de loyalty
- Integraciones (API keys, webhooks)
- Roles de usuario del admin (super admin, operador, analista)
- Auditoría de cambios

---

## API REST — Endpoints Principales

```
POST   /api/members                    # Registrar miembro
GET    /api/members/:id                # Perfil de miembro
GET    /api/members/:id/balance        # Saldo de puntos
GET    /api/members/:id/transactions   # Historial
POST   /api/events                     # Emitir evento (compra, visita, etc.)
GET    /api/campaigns                  # Listar campañas activas
POST   /api/coupons/validate           # Validar cupón
POST   /api/coupons/redeem             # Canjear cupón
GET    /api/rewards                    # Catálogo de recompensas
POST   /api/rewards/:id/redeem         # Canjear recompensa
GET    /api/members/:id/badges         # Badges del miembro
POST   /api/coalition/accumulate       # Acumular en coalición
POST   /api/coalition/redeem           # Canjear puntos coalición
POST   /api/coalition/convert          # Convertir puntos propios a coalición
GET    /api/segments/:id/members       # Miembros de un segmento
POST   /api/webhooks                   # Registrar webhook
```

**Autenticación:** API Key (server-side) + JWT (client-side portal)  
**Rate limiting:** por defecto 1000 req/min por API key  
**Versionado:** `/api/v1/...`

---

## Stack Tecnológico Detallado

| Capa                    | Tecnología                       | Justificación                            |
| ----------------------- | -------------------------------- | ---------------------------------------- |
| API Runtime             | Node.js 20 LTS + Fastify         | Performance, plugin ecosystem            |
| ORM                     | Prisma                           | Type-safe, migrations, multi-DB          |
| Base de datos principal | PostgreSQL 15                    | Transacciones ACID para ledger de puntos |
| Cache / Rate limit      | Redis 7                          | Sesiones, rate limiting, pub/sub eventos |
| Cola de trabajos        | BullMQ (Redis)                   | Notificaciones async, campañas batch     |
| Admin UI                | React 18 + Vite + TanStack Query | Performance, DX                          |
| UI Components           | shadcn/ui + Tailwind             | Customizable, accessible                 |
| Widget embebido         | Lit (Web Components)             | Framework-agnostic                       |
| Containerización        | Docker + Docker Compose          | Dev y producción                         |
| Orquestación            | Kubernetes (Helm chart incluido) | Escalabilidad                            |
| Auth                    | Lucia Auth                       | Ligero, flexible                         |
| Email                   | Resend (default) + adaptadores   | Simple, con fallback                     |
| Observabilidad          | OpenTelemetry + Prometheus       | Estándares open source                   |
| Tests                   | Vitest + Supertest               | Coverage API                             |
| CI/CD                   | GitHub Actions                   | Integrado al repo                        |

---

## Roadmap de Desarrollo (para el agente en Cowork)

### Fase 1 — Core (MVP)

1. Setup monorepo (Turborepo)
2. Schema de base de datos (Prisma migrations)
3. Motor de puntos (`packages/core`) — ledger + reglas básicas
4. API REST básica (miembros + eventos + balance)
5. Admin UI — Dashboard + Miembros
6. Docker Compose para desarrollo local
7. README + guía de instalación

### Fase 2 — Engagement

8. Motor de campañas (`packages/campaigns`) — tipos básicos
9. Constructor de campañas en Admin UI
10. Sistema de cupones (`packages/coupons`)
11. Motor de notificaciones (`packages/notifications`) — email + webhook
12. Segmentación básica (`packages/segments`)

### Fase 3 — Gamificación

13. Badges y tiers (`packages/badges`)
14. Catálogo de recompensas (`packages/rewards`)
15. Portal del cliente (vista pública embebible)
16. Widget Web Component

### Fase 4 — Coalition ✅

17. Conector genérico (`packages/coalition`) ✅
18. Implementación ApprecioAdapter ✅
19. Panel de coalición en Admin UI ✅
20. Tests de integración end-to-end ✅
21. API endpoints (accumulate, redeem, convert, reverse, link/unlink, healthcheck) ✅
22. Cifrado AES-256-GCM de credenciales, circuit breaker, retry logic ✅

### Fase 5 — Producción

21. Helm chart para Kubernetes
22. OpenTelemetry + Prometheus + Grafana dashboards
23. Documentación completa (docusaurus)
24. GitHub Actions CI/CD completo
25. Publicación en GitHub con release v1.0.0

---

## Instrucciones Específicas para el Agente en Claude Cowork

### Contexto del proyecto

Este es un proyecto open source profesional destinado a publicarse en GitHub. Cada decisión de arquitectura debe favorecer la **mantenibilidad**, **extensibilidad** y **developer experience**.

### Convenciones de código

- **TypeScript estricto** en todo el codebase (strict: true en tsconfig)
- **ESLint + Prettier** configurados desde el inicio
- **Commits semánticos**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- **Documentación inline** en inglés (JSDoc para funciones públicas de API)
- **Tests unitarios** para toda lógica de negocio en `packages/core` y `packages/campaigns`

### Principios de implementación

- **Nunca hardcodear valores de negocio**: todo configurable via env vars o tabla de configuración
- **Inmutabilidad del ledger**: las transacciones de puntos NUNCA se eliminan; se revierten con contra-asientos
- **Idempotencia en API**: usar `idempotency-key` en headers para operaciones críticas (acumulación/canje)
- **Auditoría obligatoria**: toda acción administrativa queda registrada con usuario, timestamp y diff

### Estructura de cada módulo

```
packages/[module]/
├── src/
│   ├── index.ts          # Exports públicos
│   ├── service.ts        # Lógica de negocio
│   ├── repository.ts     # Acceso a datos
│   ├── types.ts          # Interfaces y tipos
│   └── __tests__/
├── package.json
└── README.md
```

### Variables de entorno requeridas

```env
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=...
API_KEY_SALT=...

# Coalition - Apprecio
APPRECIO_API_ENDPOINT=https://api.puntos.apprecio.com/v1
APPRECIO_API_KEY=...
APPRECIO_MERCHANT_ID=...

# Notifications
RESEND_API_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
```

### Criterios de calidad para cada fase

- Toda fase debe terminar con **Docker Compose funcional** (un solo comando para levantar)
- Todo endpoint de API debe tener **esquema de validación** (Zod)
- Todo módulo nuevo debe incluir su **README.md** con ejemplos de uso
- El Admin UI debe ser **responsive** (mobile-first)

---

## Diferenciadores vs OpenLoyalty.io

| Feature                     | OpenLoyalty     | LoyaltyOS                |
| --------------------------- | --------------- | ------------------------ |
| Open Source                 | Sí (limitado)   | MIT completo             |
| Coalition nativa            | No              | Sí (Apprecio + genérico) |
| Setup en < 1 hora           | Complejo        | Docker one-liner         |
| Web Component embebible     | No              | Sí                       |
| A/B testing en campañas     | No              | Sí                       |
| GraphQL API                 | No              | Sí                       |
| Multi-tenant                | Enterprise only | Incluido                 |
| Builder de segmentos visual | Básico          | Avanzado                 |

---

## Nombre del Proyecto en Cowork

**Proyecto:** `LoyaltyOS — Open Source Loyalty Platform`  
**Descripción corta:** Plataforma open source de customer loyalty con soporte para coalición de puntos (Apprecio), motor de puntos propio, campañas, cupones, badges y recompensas. Stack: Node.js + React + PostgreSQL.  
**Idioma de trabajo del agente:** Inglés (código y docs) / Español (comunicación con Jaime)

---

_Documento generado para configurar el proyecto en Claude Cowork. El agente debe leer este documento completo antes de ejecutar cualquier tarea de desarrollo._
