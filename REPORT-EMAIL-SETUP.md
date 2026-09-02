# Secure PIN report email setup

This implements a server-enforced approval step for the legacy PIN app. PINs
and browser roles do not authorize email sends.

## 1. Apply the schema

In Supabase Dashboard -> SQL Editor, run `schema-report-approval.sql` once.
It creates private approval and audit tables. Do not add anonymous policies to
these tables.

## 2. Set Edge Function secrets

Supabase Dashboard -> Edge Functions -> Secrets. Set these values:

| Secret | Example |
| --- | --- |
| `RESEND_API_KEY` | `re_...` sending-only key |
| `REPORT_FROM` | `Procurement <noreply@mail.sprig.store>` |
| `APP_ORIGIN` | `https://pethupraveen.github.io` |
| `REPORT_APPROVER_EMAILS` | `["md@sprig.store"]` |
| `REPORT_RECIPIENTS` | `["md@sprig.store","factory@vendor.example"]` |
| `REPORT_APPROVAL_PEPPER` | A private random 32-byte value |

The two JSON email lists must contain valid addresses. They are server-only;
the browser does not display or modify them. `APP_ORIGIN` has no repository
path or trailing slash.

## 3. Deploy both functions

The committed `supabase/config.toml` deliberately disables the platform JWT
gateway only for these two functions, so browser CORS preflight can reach their
handlers. The handlers perform their own approval checks for every send.

```powershell
supabase functions deploy request-stp-report-approval --project-ref <project-ref>
supabase functions deploy send-stp-report --project-ref <project-ref>
```

## 4. Verify

1. In the PIN app, open STP requirement and select **Email MD / Factory**.
2. Confirm the configured approver receives an eight-character code.
3. Enter that code. Confirm exactly one email reaches only the configured
   recipients.
4. Reuse the same code: it must fail and send no second email.
5. Enter an invalid code five times: it must fail; request a new code.
6. Inspect `report_send_log` in SQL Editor. It records `sent` or `failed` and
   the Resend ID without exposing it to browser callers.

Do not redeploy the former unauthenticated `send-stp-report` implementation.
