# Manual Point Adjustments

Operators and super admins can manually credit or debit a member's points from
the admin UI. Every adjustment is written to the immutable points ledger and to
the audit log.

## Roles

| Action                          | Who can do it                               |
| ------------------------------- | ------------------------------------------- |
| Request an adjustment           | SUPER_ADMIN, OPERATOR (`members.write`)     |
| Approve or reject a request     | SUPER_ADMIN only (`members.adjust.approve`) |
| Configure the adjustment limits | SUPER_ADMIN only (`program.write`)          |

## Operator workflow

1. Open the member's profile (`Members` → member).
2. Click **Adjust points**.
3. Enter the **amount** (positive to add points, negative to deduct), choose a
   **category**, and write a **comment** of at least 10 characters explaining
   the adjustment.
4. Submit.

The dialog previews the resulting balance before you submit.

If the amount is within your limits, the points are applied immediately and the
member's balance updates. If it exceeds a limit, the request is marked
**Pending** and a super admin must approve it before the points are applied.

## Limits

Each program has three limits (configurable in **Settings**):

- **Operator per-transaction limit** — the largest single adjustment an operator
  can apply on their own.
- **Operator daily limit** — the largest total an operator can self-approve in a
  UTC day.
- **Server per-transaction limit** — the largest adjustment a SERVER API key can
  apply. Above this, the request is rejected (never pending).

Pending requests expire after 7 days if nobody decides on them.

## Reviewing requests (super admin)

Open **Point adjustments** to see all requests, filter by status, and act on
pending ones:

- **Approve** — applies the points and links the ledger transaction.
- **Reject** — records the rejection and leaves the balance unchanged.

You cannot decide on your own requests. Pending requests close to their expiry
show a warning so they can be reviewed in time.
