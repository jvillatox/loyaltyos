# LoyaltyOS Assistant — Workflow Playbooks

Detailed step-by-step guides for the 8 core workflows. Each playbook includes trigger phrases,
tool chain, decision points, fallback paths, and an example output narrative.

---

## 1. Weekly Program Health Check

**Trigger phrases:**

- "¿Cómo está el programa esta semana?"
- "Dame un resumen del programa"
- "¿Cómo vamos este mes?"
- "Health check del programa"
- "¿Qué tal están los KPIs?"

**Tool chain:**

1. `analytics_dashboard` (period="7d")
2. `campaigns_list` (status="active")
3. `members_list` (inactiveDays=30, limit=5)

**Decision points:**

- If `redemptionRate > 0.50`: flag high burn risk — "El ritmo de canje está alto. Considera ajustar multiplicadores o revisar el catálogo de recompensas."
- If `activeMembers` dropped >10% vs previous week: "Los miembros activos bajaron. ¿Quieres crear una campaña de reactivación?"
- If `totalLiability` is growing faster than new members: warn about liability ratio

**Fallback:** If `campaigns_list` returns zero active campaigns, suggest: "No hay campañas activas ahora. ¿Quieres crear una?"

**Example output narrative:**

```
📊 Resumen semanal — LoyaltyOS

Miembros activos: 45.230 (+3% vs semana anterior)
Puntos emitidos (7d): 1.250.000
Puntos canjeados (7d): 520.000
Tasa de canje: 41.6%

Campañas activas (3):
- Doble Puntos Fin de Semana: 12.400 miembros alcanzados, 89.000 pts emitidos
- Bienvenida Gold: 340 nuevos gold, 34.000 pts emitidos
- Reactivación 60d: 1.200 miembros contactados, tasa de retorno 18%

⚠️  Riesgo: 1.850 miembros llevan >30 días sin actividad (4.1% de la base activa)

Recomendaciones:
1. Crear una campaña flash para miembros inactivos >60 días
2. Revisar el catálogo de recompensas — las de tipo "experiencia" tienen 0 canjes este mes
```

---

## 2. Create a Reactivation Campaign

**Trigger phrases:**

- "Crea una campaña de reactivación"
- "Quiero recuperar clientes inactivos"
- "Hagamos una campaña win-back"
- "Los clientes no están comprando, ¿qué podemos hacer?"

**Tool chain:**

1. Ask: "¿Cuántos días sin actividad define 'inactivo'?" (default: 60)
2. Call `segment_preview`:
   ```json
   {
     "rules": [{ "field": "inactiveDays", "operator": "gte", "value": 60 }],
     "sampleSize": 5
   }
   ```
3. Show results: estimated reach + sample members
4. Propose campaign:
   ```json
   {
     "name": "Te Extrañamos — 2x Puntos por Regresar",
     "type": "bonus_points",
     "startDate": "<today ISO>",
     "endDate": "<today + 30d ISO>",
     "rules": { "multiplier": 2 },
     "status": "draft"
   }
   ```
5. Ask: "Son X miembros elegibles. ¿Activo la campaña ahora o la dejo en borrador?"
6. Call `campaign_create` with chosen status
7. Offer: "¿Quieres acompañarla con un cupón de bienvenida?"

**Decision points:**

- If estimated reach < 100: suggest broadening criteria (30 days instead of 60)
- If estimated reach > 80% of base: suggest narrowing (add tier or balance filters)
- If `coalitionEnabled`: offer "¿Quieres también enviar puntos de coalición como incentivo extra?"

**Fallback:** If segment_preview errors, fall back to manual filters with `members_list`

**Example output:**

```
He detectado 2.340 miembros inactivos por más de 60 días (5.2% de la base).

Propuesta de campaña:
- Nombre: "Te Extrañamos — 2x Puntos por Regresar"
- Tipo: Bonus Points (multiplicador 2x)
- Duración: 30 días
- Audiencia estimada: 2.340 miembros

¿Activo la campaña ahora o la dejo en borrador para revisarla?
```

---

## 3. Member Investigation

**Trigger phrases:**

- "¿Quién es el miembro X?"
- "Dame el perfil de alice@example.com"
- "Investiga al cliente con ID mem_123"
- "¿Qué ha hecho este miembro?"

**Tool chain:**

1. `member_get` (memberId)
2. `member_points_history` (memberId, limit=20)
3. `member_badges` (memberId, includeProgress=true)

**Decision points:**

- If last activity > 90 days ago: flag "⚠️ Miembro en riesgo de abandono"
- If recent point adjustments detected: flag for manual review
- If close to tier upgrade threshold: suggest "Está a X puntos del siguiente tier. ¿Quieres asignarle una campaña de aceleración?"

**Fallback:** If `member_get` returns NOT_FOUND, try `members_list` with search parameter

**Example output:**

```
👤 Perfil de Alice Martínez (mem_abc123)

Tier: Gold | Saldo: 1.500 puntos | Pendiente: 50 pts
Miembro desde: 15/03/2023 | Última actividad: 18/05/2026
Gasto total: $245.000

Últimos movimientos (20):
- 18/05: +200 pts — Compra en tienda online
- 15/05: -500 pts — Canje: Gift Card $5.000
- 12/05: +100 pts — Campaña: Doble Puntos Finde
- 10/05: +1.000 pts — Ajuste manual: Compensación por error en envío ⚠️

Badges ganados (4/7):
✅ Primeros 100 Puntos   ✅ Comprador Frecuente
✅ Gold Member           ✅ 10 Canjes Completados

En progreso:
🔄 Super Canjeador (60%)  🔄 50 Transacciones (80%)
🔄 Platinum (a 3.500 puntos del umbral — 30%)

⚠️  Ajuste manual de +1.000 pts detectado el 10/05. Verificar nota de auditoría.
💡 Alice está a 3.500 pts de Platinum. ¿Le ofrecemos una campaña de aceleración?
```

---

## 4. Build a Targeted Segment

**Trigger phrases:**

- "Crea un segmento de..."
- "Quiero agrupar a los clientes que..."
- "Segmenta a los miembros gold inactivos"
- "Necesito una audiencia para una campaña"

**Tool chain:**

1. Clarify criteria in Spanish
2. Translate to segment rules (see field reference below)
3. Call `segment_preview` with sampleSize=5
4. Show count and 3 sample members
5. If count OK: call `segment_create`
6. Offer: "¿Quieres crear una campaña para este segmento?"

**Available fields for rules:**
| Field | Operators | Example Value |
| ----------------------- | ------------------ | -------------------- |
| `pointBalance` | gt, lt, gte, lte | 1000 |
| `tier` | eq, in, not_in | "gold" |
| `inactiveDays` | gt, lt, gte, lte | 60 |
| `totalSpend` | gt, lt, gte, lte | 50000 |
| `joinedDaysAgo` | gt, lt, gte, lte | 365 |
| `lastPurchaseDaysAgo` | gt, lt, gte, lte | 30 |
| `tags` | in, not_in | ["vip", "early_adopter"] |

**Decision points:**

- If estimatedSize < 50: warn "Muy pocos miembros. Amplía los criterios o el segmento no será útil."
- If estimatedSize > 80% of base: warn "El segmento es muy amplio. Agrega más filtros para que sea accionable."
- For AND logic with 3+ rules: check if the segment might be too restrictive

**Fallback:** If segment creation fails, verify rule field names and operators. Offer to list existing segments with `segments_list`.

**Example output:**

```
Segmento: "Gold en Riesgo"
- tier = gold
- inactiveDays ≥ 30
- Lógica: AND

Vista previa: 1.340 miembros (3.0% de la base)

Muestra:
- maria@email.com — Gold, 45 días inactiva, saldo 2.300 pts
- juan@email.com — Gold, 32 días inactivo, saldo 8.100 pts
- laura@email.com — Gold, 38 días inactiva, saldo 950 pts

¿Creo el segmento? Luego puedo crear una campaña para este grupo.
```

---

## 5. Coalition Report

**Trigger phrases:**

- "¿Cómo está la coalición?"
- "Muéstrame la actividad de Puntos Apprecio"
- "¿Cuántos puntos de coalición tiene el miembro X?"
- "Convierte puntos a coalición para..."

**Tool chain:**

1. Call `program_config_get` to confirm coalition is enabled
2. If enabled, show conversion rate and flow options
3. For a specific member: call `coalition_balance` + `member_get`

**Decision points:**

- If `coalitionEnabled: false`: explain how to enable it and suggest next steps
- If `coalitionProvider` is null: "La coalición está habilitada pero sin proveedor configurado"
- For conversion: check if `ownPoints >= min_conversion_points` (program config)

**Fallback:** If coalition API errors, verify `LOYALTYOS_API_KEY` has coalition scope

**Example output:**

```
🏦 Estado de Coalición

Proveedor: Puntos Apprecio
Tasa de conversión: 1 punto LoyaltyOS = 1 Punto Apprecio

Para el miembro Carlos López (mem_xyz):
- Saldo LoyaltyOS: 3.200 puntos
- Saldo Apprecio: 1.500 puntos
- Total combinado: 4.700 puntos

Carlos puede convertir sus puntos o acumular más en cualquiera de los dos sistemas.
¿Quieres convertir puntos o ver el histórico de transacciones?
```

---

## 6. Flash Sale Campaign

**Trigger phrases:**

- "Crea una campaña flash"
- "Quiero una promoción relámpago"
- "Hagamos una campaña de tiempo limitado"
- "Campaña de ventana corta"

**Tool chain:**

1. Ask: "¿Cuál es el multiplicador? (ej: 3x, 4x, 5x)" (default: 3x)
2. Ask: "¿Duración? (ej: 24h, 48h, fin de semana)" (default: 48h)
3. Ask: "¿Quieres limitar usos por miembro?" (default: 3)
4. If targeting a segment: call `segment_preview` first
5. Call `campaign_create`:
   ```json
   {
     "name": "Flash — Multiplicador X por Y horas",
     "type": "flash_sale",
     "startDate": "<now ISO>",
     "endDate": "<now + duration ISO>",
     "rules": { "multiplier": X, "maxUsesPerMember": Y },
     "status": "active"
   }
   ```

**Decision points:**

- Flash sale without status="active" → remind operator it needs manual activation
- Budget cap: always set one for flash sales to control liability
- If it overlaps with another active campaign: warn about stacking rules

**Example output:**

```
⚡ Campaña Flash configurada:

- "Flash 4x — 48 Horas"
- Multiplicador: 4x puntos
- Duración: 48 horas (20/05 14:00 → 22/05 14:00)
- Límite: 3 usos por miembro
- Presupuesto máximo: 50.000 puntos
- Audiencia: todos los miembros activos

⚠️  Esta campaña NO es stackable con otras campañas de bonus points.
¿La activo ahora?
```

---

## 7. Tier Upgrade Campaign

**Trigger phrases:**

- "Campaña para subir de tier"
- "Quiero acelerar upgrades a Gold"
- "Incentivar a los Silver que están cerca de Gold"
- "Campaña de aceleración de tier"

**Tool chain:**

1. Call `program_config_get` to get tier thresholds
2. Pick target tier and calculate the gap
3. Call `segment_preview` with rules targeting members near the threshold:
   ```json
   {
     "rules": [
       { "field": "tier", "operator": "eq", "value": "silver" },
       { "field": "pointBalance", "operator": "gte", "value": 750 },
       { "field": "pointBalance", "operator": "lt", "value": 1000 }
     ],
     "logic": "AND"
   }
   ```
4. Show estimated reach
5. Ask for confirmation
6. Call `campaign_create` with type="tier_upgrade_bonus"

**Decision points:**

- If the gap is too large (>50% of threshold): the campaign won't feel achievable
- Offer to pair with a milestone badge

**Example output:**

```
🏆 Campaña de Aceleración — Rumbo a Gold

Tier objetivo: Gold (umbral: 1.000 puntos)
Members Silver con 750-999 puntos: 340 miembros

Propuesta:
- "Rumbo a Gold — Bonus 250 pts"
- Tipo: tier_upgrade_bonus
- Los miembros en el rango 750-999 pts reciben 250 pts extra en su próxima compra
- Esto lleva a ~200 miembros al umbral de Gold inmediatamente

¿Creo la campaña?
```

---

## 8. Month-End Points Expiry Alert

**Trigger phrases:**

- "¿Hay puntos por vencer?"
- "Alerta de vencimiento de puntos"
- "Campaña para miembros con puntos próximos a vencer"
- "Recuérdale a los clientes que usen sus puntos"

**Tool chain:**

1. Call `program_config_get` to check `pointExpiryDays`
2. If expiry is configured, calculate the expiry window
3. Call `members_list` with `minBalance: 1` (members with points)
4. Explain that LoyaltyOS handles expiry notifications automatically via the notification engine
5. Offer: "¿Quieres crear una campaña recordatorio para los próximos 30 días?"

**Decision points:**

- If `pointExpiryDays` is null: inform the operator that expiry is not configured
- Suggest configuring expiry if not set: "Configurar vencimiento de puntos ayuda a mantener la liability bajo control"

**Fallback:** The MCP server doesn't have a direct "expiring points" endpoint. Use `members_list` with relevant filters and explain the notification module.

**Example output:**

```
📅 Control de Vencimiento

El programa tiene vencimiento configurado a 365 días.

Los miembros reciben notificaciones automáticas:
- 30 días antes del vencimiento (email)
- 7 días antes del vencimiento (email + push)

¿Quieres crear una campaña extra de recordatorio con bonus points para incentivar
el canje antes del vencimiento? Puedo segmentar a los miembros con saldo >500 pts
y última actividad >90 días.
```
