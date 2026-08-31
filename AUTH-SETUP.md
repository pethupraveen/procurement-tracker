# Auth setup

How to move a Supabase project from anonymous access to Supabase Auth accounts.
Most steps are done by the Admin in the Supabase Dashboard; publishing the
browser build is the stated exception. The browser app never receives a
service-role key and cannot create accounts or reset passwords.

Run these steps in order. Publishing the Auth-capable browser before the RLS
migration is essential: applying the migration while GitHub Pages still serves
the old name/PIN build leaves everyone with a database it can no longer use.

~~~mermaid
flowchart LR
    U[1. Configure Auth URL] --> B[2. Publish Auth-capable build]
    B --> M[3. Run schema-auth.sql]
    M --> A[4. Create the four Auth users]
    A --> P[5. Check the profiles]
    P --> F[6. Deploy secured report function]
    F --> V[7. Verify the cutover]
~~~

## Who gets an account

| Name | Email | Role | Notes |
| --- | --- | --- | --- |
| Vikram | <code>vikram@sprig.store</code> | Admin | Full access; the only role allowed to send the STP report |
| Praveen | <code>praveen@sprig.store</code> | Procurement | |
| Krishna | <code>krishna@sprig.store</code> | Warehouse | |
| Yabinesh | <code>yabinesh@sprig.store</code> | Catalog | |

Sales is intentionally excluded. No Sales account is approved, and creating one
in the Dashboard would not grant access: an Auth user with no allowlisted email
gets no profile and therefore no role.

> Confirm these four addresses before running the migration. They come from the
> planning document, not from the existing database — the old <code>users</code>
> rows have no email addresses. If a real address differs, edit the allowlist
> seed in [schema-auth.sql](schema-auth.sql) first; the address in the allowlist
> must match the Auth user's email exactly (case is ignored).

## 1. Configure the app URL

Dashboard → **Authentication** → **URL Configuration**:

- **Site URL**: <code>https://pethupraveen.github.io/procurement-tracker/</code>
- **Redirect URLs**: add the same URL, plus <code>http://localhost:5173/</code>
  for local development.

Email/password sign-in works without this, but password-recovery links land on
the wrong origin if the Site URL is unset.

## 2. Publish the Auth-capable browser build

Before changing database access, deploy the version of this app that has the
email/password sign-in screen and reads its role from <code>profiles</code>.

1. In GitHub **Settings → Secrets and variables → Actions**, confirm
   <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are
   configured for this project. They are public browser configuration values,
   not service-role credentials.
2. Push the Auth-capable commit to <code>main</code> and wait for the GitHub
   Pages deployment to succeed. Run <code>npm run build</code> before pushing.
3. Open the production tracker and confirm it presents **Email address** and
   **Password**, not the old account/PIN selector. A missing database
   configuration screen means the two <code>VITE_*</code> values were not
   published correctly.

It is expected that nobody can sign in yet: the approved Auth users are created
after the migration. Do not apply RLS until this Auth-capable build is live.

## 3. Run the migration

Dashboard → **SQL Editor** → **New query** → paste [schema-auth.sql](schema-auth.sql) → **Run**.

It does not delete phones, users, or any other data, and it can be re-run
safely. It creates <code>profiles</code> and <code>profile_allowlist</code>,
drops the anonymous policies on <code>phones</code> and <code>users</code>, and
grants the app's access to signed-in users instead.

The SQL Editor runs the script as one transaction, so a failure applies nothing.
If it stops on the trigger over <code>auth.users</code> — the statement that
creates a profile automatically for each approved account — the connected role
lacks rights on the <code>auth</code> schema. Delete that
<code>create trigger on_auth_user_created</code> statement, run the rest, create
the Auth users, then re-run the file's backfill <code>insert into
public.profiles … select … from auth.users</code> to give them profiles.

## 4. Create the four Auth users

For each row of the table above: Dashboard → **Authentication** → **Users** →
**Add user** → **Create new user**.

- **Email**: the address from the table.
- **Password**: a distinct initial password per person, at least 12 characters,
  not reused from anywhere else. Do not commit these to the repository or paste
  them into a shared document — send each person their own password over a
  private channel and ask them to have it changed.
- **Auto Confirm User**: on. There is no email-confirmation flow in the app.

Passwords are managed only here. To reset one, use **Authentication → Users →
… → Reset password** (or set a new password directly). The app has no
self-service reset and no in-app account creation.

## 5. Check the profiles were created

Each new Auth user triggers a profile insert if its email is allowlisted. In the
SQL Editor:

~~~sql
select p.id, p.name, p.role, u.email
from profiles p
join auth.users u on u.id = p.id
order by p.role;
~~~

Expect exactly four rows — one Admin, one Procurement, one Warehouse, one
Catalog. If someone is missing, their Auth email does not match the allowlist:
fix the address in <code>profile_allowlist</code> (or the Auth user), then
re-run <code>schema-auth.sql</code>, which backfills profiles for allowlisted
accounts that already exist.

To change a role later, update the row in both <code>profiles</code> and
<code>profile_allowlist</code>. Re-running the migration never overwrites an
existing profile.

## 6. Deploy the secured report-email function

Set these **Supabase Edge Function secrets** (not browser variables and not
GitHub Actions secrets):

~~~bash
supabase secrets set --project-ref <project-ref> \
  RESEND_API_KEY=re_xxx \
  REPORT_FROM="Procurement <noreply@your-verified-domain.com>" \
  APP_ORIGIN="https://pethupraveen.github.io"

supabase functions deploy send-stp-report --project-ref <project-ref>
~~~

The committed [supabase/config.toml](supabase/config.toml) sets
<code>verify_jwt = false</code> only for <code>send-stp-report</code>. This is
deliberate: browser <code>OPTIONS</code> preflights have no bearer token, so the
platform JWT gate would otherwise reject them before the handler can return its
restricted CORS response. The function itself still verifies every POST's
bearer token with Supabase Auth and checks the caller's server-side
<code>profiles.role = 'admin'</code> before reading the report body or sending
mail. Do not use a broad <code>--no-verify-jwt</code> deployment override for
other functions.

<code>APP_ORIGIN</code> is an origin, not a page URL: omit the
<code>/procurement-tracker/</code> path. It must exactly match the deployed
browser origin. For a local browser test, temporarily set it to
<code>http://localhost:5173</code>, then restore the GitHub Pages origin before
production use.

<code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code>, and
<code>SUPABASE_SERVICE_ROLE_KEY</code> are supplied to Supabase Edge Functions
by Supabase. If your project does not expose them to the function runtime, set
them as function secrets from **Settings → API** before deploying. The service
role key is server-only: never copy it into <code>VITE_*</code>, the app's saved
database configuration, GitHub Actions, or a shared document.

## 7. Verify the cutover

Sign in to the app itself:

1. Open the tracker. It asks for an email and a password — if it asks for a
   Supabase URL and key instead, this browser has no saved connection; paste
   them from **Settings → API** and continue.
2. Sign in as one of the four accounts. The name and role in the header come
   from <code>profiles</code>, not from anything typed in the browser.
3. Reload the page. It should return to the tracker, not to the sign-in screen:
   the session is stored and its token refreshed.
4. Sign out. The session is dropped, and reloading lands on the sign-in screen.
5. Sign in as an Auth account that is not on the allowlist — create a throwaway
   one if you want to test this. It is refused with "This account is not
   approved for the tracker", because it has no profile row. Delete it
   afterwards.

Then check the API directly.

Anonymous access is refused (uses the public key the browser bundle carries):

~~~bash
curl -s -w '\n%{http_code}\n' \
  "https://<project>.supabase.co/rest/v1/phones?select=id&limit=1" \
  -H "apikey: <anon-key>"
~~~

Expect a <code>permission denied for table phones</code> error and a
<code>401</code> or <code>403</code> status — the same for <code>users</code>,
<code>profiles</code>, and <code>stage_summary</code>. A <code>200</code>
carrying rows, or an empty <code>[]</code>, means the migration did not run.

A signed-in user can read the tracker data:

~~~bash
TOKEN=$(curl -s "https://<project>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <anon-key>" -H "content-type: application/json" \
  -d '{"email":"vikram@sprig.store","password":"<initial password>"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')

curl -s -o /dev/null -w '%{http_code}\n' \
  "https://<project>.supabase.co/rest/v1/phones?select=id&limit=1" \
  -H "apikey: <anon-key>" -H "authorization: Bearer $TOKEN"
~~~

Expect <code>200</code>. The public key is still required as the
<code>apikey</code> header; it is no longer a credential on its own.

Existing data is untouched — compare before and after:

~~~sql
select count(*) as phones, max(updated_at) as newest from phones;
~~~

Verify the deployed endpoint with a small valid body and the tokens obtained in
the checks above. Use a fresh recipient address you control and inspect the
Resend dashboard after each request:

1. Call the endpoint with no <code>Authorization</code> header. It must return
   <code>401</code>; Resend must show no email attempt.
2. Sign in as Procurement, then call it with that access token. It must return
   <code>403</code>; Resend must show no email attempt.
3. Sign in as the Admin and use **STP requirement → Email MD / Factory** in the
   app. It must send exactly one report to the configured recipients. The
   recipient control and email action are visible only to Admins.
4. In the deployed browser, verify the function's allowed-origin preflight
   succeeds. Try an invalid recipient, more than 25 recipients, more than 500
   rows, or a request from an origin other than <code>APP_ORIGIN</code>. The
   function must reject it before sending mail. A different browser origin is
   also stopped by CORS preflight.

## What this does not do

Any signed-in user can write any phone row. The per-stage rules — only
Procurement assigns a PO, only Catalog receives stock — are still enforced in
the browser only, and a signed-in user with an HTTP client can bypass them.
Closing that needs server-side commands and is deliberately out of scope here.

The legacy <code>users</code> table is left in place, readable by signed-in
users and writable by nobody. It still holds the old hashed PINs and is no
longer used for authorization: the app never reads it. Drop it once its contents
are no longer needed.

The report-email function is an authorization boundary for this one outbound
operation, not a general authorization layer for tracker data. Per-stage write
rules still need server-side commands or RPCs.
