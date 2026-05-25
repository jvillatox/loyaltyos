# LoyaltyOS Assistant — Example Prompts

15 diverse examples covering Spanish and English prompts, edge cases,
and multi-tool workflows.

---

## 1. Program Health Check (Spanish)

**Prompt:** "¿Cómo está el programa esta semana?"

**Expected tool chain:**

1. `analytics_dashboard` (period="7d")
2. `campaigns_list` (status="active")
3. `members_list` (inactiveDays=30, limit=5)

**Response outline:** KPI summary table + active campaigns + risk alerts + 2 recommendations. All in Spanish.

---

## 2. Program Health Check (English)

**Prompt:** "Give me a program summary for the last 30 days"

**Expected tool chain:**

1. `analytics_dashboard` (period="30d")
2. `campaigns_list` (status="active")

**Response outline:** Same as above, operator may use English but assistant responds in Spanish.

---

## 3. Create Campaign with Audience Preview

**Prompt:** "Crea una campaña de puntos dobles para el fin de semana para miembros gold"

**Expected tool chain:**

1. `segment_preview` — rules: [{ field: "tier", operator: "eq", value: "gold" }], sampleSize=5
2. Show estimated reach → ask confirmation
3. `campaign_create` — type="bonus_points", rules: { multiplier: 2 }

**Response outline:** Show segment stats, confirm, then create. Propose weekend dates.

---

## 4. Member Not Found (Edge Case)

**Prompt:** "¿Quién es el miembro con email noexiste@email.com?"

**Expected tool chain:**

1. `member_get` → NOT_FOUND error

**Response outline:** "No encontré ese miembro. ¿Quieres buscar por otro criterio? Puedo listar miembros o buscar por nombre."

---

## 5. Full Member Investigation (Spanish)

**Prompt:** "Dame el perfil completo de mem_abc123"

**Expected tool chain:**

1. `member_get` (memberId="mem_abc123")
2. `member_points_history` (memberId="mem_abc123", limit=20)
3. `member_badges` (memberId="mem_abc123", includeProgress=true)

**Response outline:** Narrative profile with tier, balance, transaction history, badges, progress bars, and anomaly flags.

---

## 6. Build and Use a Segment (Multi-step)

**Prompt:** "Encuentra clientes gold que no hayan comprado en 60 días y crea una campaña para ellos"

**Expected tool chain:**

1. `segment_preview` — rules: [{ field: "tier", operator: "eq", value: "gold" }, { field: "inactiveDays", operator: "gte", value: 60 }], logic="AND"
2. Show count + sample → warn if applicable
3. Ask: "¿Creo el segmento primero?"
4. `segment_create`
5. Propose campaign: bonus_points, multiplier=2x, 30 days
6. `campaign_create`

**Response outline:** Segment preview → confirmation → segment created → campaign proposal → confirmation → campaign created.

---

## 7. Empty Segment Warning (Edge Case)

**Prompt:** "Segmenta a miembros platinum que llevan más de 365 días inactivos"

**Expected tool chain:**

1. `segment_preview` — rules: [{ field: "tier", operator: "eq", value: "platinum" }, { field: "inactiveDays", operator: "gte", value: 365 }]

**Response outline:** If count is very low: "Solo hay 12 miembros que cumplen estos criterios. Es una base muy pequeña para una campaña. ¿Quieres ampliar a gold y platinum, o reducir el umbral de inactividad a 180 días?"

---

## 8. Coalition Conversion Flow

**Prompt:** "Convierte 1.000 puntos de Carlos López a Puntos Apprecio"

**Expected tool chain:**

1. `members_list` (search="Carlos") or `member_get` if ID known
2. `program_config_get` — check coalition enabled and conversion rate
3. Show: "Tienes X puntos. Convertirás Y a Z Puntos Apprecio. ¿Confirmas?"
4. `coalition_convert` (memberId, ownPoints=1000)

**Response outline:** Confirmation with conversion math → execute → show new balances.

---

## 9. Coalition Disabled (Edge Case)

**Prompt:** "¿Cuántos puntos de coalición tengo?"

**Expected tool chain:**

1. `program_config_get` → coalitionEnabled: false

**Response outline:** "La coalición no está habilitada en este programa. Para activarla, configura las variables APPRECIO_API_KEY y APPRECIO_MERCHANT_ID en el archivo .env del API."

---

## 10. Create Campaign with Budget Cap

**Prompt:** "Crea una campaña de frecuencia: 5 visitas en 30 días dan 200 puntos bonus, con presupuesto máximo de 10.000 puntos"

**Expected tool chain:**

1. `segment_preview` if targeting a segment (optional — might target everyone)
2. `campaign_create` — type="frequency", rules: { visits: 5, windowDays: 30, bonusPoints: 200 }, budgetCap=10000

**Response outline:** Show campaign summary with budget info, confirm, then create.

---

## 11. Adjust Points with Audit Note

**Prompt:** "Súmale 500 puntos al miembro mem_xyz como compensación por un pedido que llegó tarde"

**Expected tool chain:**

1. `member_get` (memberId="mem_xyz") — show current balance first
2. Show: "Vas a ajustar +500 pts a [nombre]. Saldo actual: X. Saldo nuevo: X+500. Nota: 'Compensación por pedido con entrega tardía'. ¿Confirmas?"
3. `member_adjust_points` (memberId, amount=500, note, idempotencyKey=<UUID>)

**Response outline:** Current state → confirmation → execute → show new balance.

---

## 12. Points Adjustment — Note Too Short (Edge Case)

**Prompt:** "Resta 100 puntos a mem_abc"

**Expected tool chain:**

1. Ask: "Necesito una nota de auditoría de al menos 10 caracteres explicando el motivo del ajuste. ¿Por qué estamos restando estos puntos?"

**Response outline:** Don't call the tool — the Zod schema will reject it anyway. Request proper audit note first.

---

## 13. Campaign Budget Exceeded (Edge Case)

**Prompt:** Operator tries to create a campaign that would exceed the practical budget

**Expected tool chain:**

1. `segment_preview` — estimate reach
2. Calculate: estimatedReach × pointsPerMember = projected cost
3. Show: "Esta campaña podría costar hasta X puntos con el presupuesto actual de Y. ¿Ajusto el presupuesto o reduzco la audiencia?"

**Response outline:** Proactive budget warning before creating.

---

## 14. Top Members by Balance (Analytics + Members)

**Prompt:** "¿Quiénes son los 10 miembros con mayor saldo de puntos?"

**Expected tool chain:**

1. `members_list` — no specific filter, large limit
   - Note: The API doesn't support sorting by balance directly. Use `members_list` and explain the limitation.
2. Present results as a ranked table

**Response outline:** Ranked table + offer: "¿Quieres crear una campaña para incentivar el canje en estos high-balance members?"

---

## 15. Create Coupon + Campaign Combo

**Prompt:** "Quiero una campaña de verano con cupón de descuento del 15% para todos los miembros"

**Expected tool chain:**

1. `coupon_create` — type="percent_off", value=15, mode="single_code" (auto-generate code)
2. `campaign_create` — type="bonus_points", name="Verano 2026", rules: { multiplier: 1.5 }
3. Show confirmation for each, then present the combo summary

**Response outline:** "Primero, creo el cupón. Luego, la campaña. ¿O prefieres hacer uno a la vez?" → execute → combo summary with campaign ID and coupon code.
