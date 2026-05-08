# Authentication setup guide

This preview ships **demo accounts only**. There is no real OAuth flow, no real
Microsoft / Google secret, and no outbound mail server. Selecting an account on
the login screen simply tells the client which `x-rfq-user-id` header to send.

This document describes how to wire real authentication when this app is
promoted out of the sandbox preview, without changing the data model or
permission predicates that already ship.

---

## Architecture today

```
[Login screen] → AuthProvider (React state, not persisted)
                  ↓ headers: x-rfq-user-id, x-rfq-role, x-rfq-scope-id, x-rfq-commercial-grant
[Express routes] → attachRole middleware
                  ↓ if x-rfq-user-id is set, look up the user, validate active=true,
                    and derive role / scope / commercial grant from the user record
                  ↓ otherwise, fall back to legacy role/scope/grant headers
                    (existing tests and tools that don't yet sign in still work)
[Storage] → users table (see shared/schema.ts)
```

User directory fields:

| Field                | Meaning                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `id`                 | Primary key                                                                              |
| `name`, `email`      | Display + lookup key. `email` must be unique.                                            |
| `userType`           | `internal` (TEG staff) or `external` (subcontractor / partner).                          |
| `authProvider`       | `microsoft`, `google`, `magic_link`, `demo`. Informational in the preview.               |
| `role`               | One of the canonical roles: `group_admin`, `buyer`, `commercial_staff`, `factory_user`, `subcontractor_user`. |
| `scopeType`/`scopeId`| Anchor scope. `scopeId` mirrors `companyId`/`factoryId`/`subcontractorId` as appropriate.|
| `companyId`          | For buyer / commercial_staff: cluster anchor company.                                    |
| `factoryId`          | For factory_user.                                                                        |
| `subcontractorId`    | For subcontractor_user.                                                                  |
| `clusterName`        | Cluster label (e.g. "Tropicoir / Premier Tech").                                         |
| `commercialGrant`    | `true` when TEG admin has granted send / negotiate / recommend on a commercial_staff.    |
| `active`             | `false` blocks the account at the API gate (HTTP 403).                                   |
| `lastLoginAt`        | Updated by `GET /api/me`.                                                                |

---

## Internal users — Microsoft Entra (Outlook)

TEG corporate identities live in Microsoft Entra. Use Authorization Code Flow
(`@azure/msal-node`) with PKCE.

Required server env vars:

```
MS_TENANT_ID=<your-tenant-id-or-common>
MS_CLIENT_ID=<app-registration-client-id>
MS_CLIENT_SECRET=<app-registration-secret>          # confidential client
MS_REDIRECT_URI=https://<host>/auth/microsoft/callback
```

App registration redirect URI placeholders:

- `https://localhost:5000/auth/microsoft/callback` (development)
- `https://<host>/auth/microsoft/callback` (production)

Provider mapping — on successful callback, claim → user mapping:

| Microsoft claim        | User directory field           |
| ---------------------- | ------------------------------ |
| `preferred_username`   | `email`                        |
| `name`                 | `name`                         |
| `tid` (tenant)         | gate: must equal `MS_TENANT_ID`|
| `oid`                  | use to upsert by stable id     |
| `roles` / app role     | seeds `role` on first sign-in  |

On callback:

1. Validate the ID token signature, audience, issuer, `tid`.
2. `getUserByEmail(claims.preferred_username)` → if missing, create with
   `authProvider="microsoft"` and `role="commercial_staff"` (default; admin can
   promote later) or whatever app role the directory provides.
3. If `active=false`, redirect to a friendly "account inactive" page.
4. Issue a server session cookie (HTTP-only, `SameSite=Lax`) carrying just the
   `userId`. The same `attachRole` middleware that already handles
   `x-rfq-user-id` will work; replace the header read with a session read.

---

## External users — Google + magic link

Subcontractors today use tokenized portal links — that flow does **not** require
this auth layer and remains the primary path. Magic link / Google is for self-
service sign-in (e.g. when a subcontractor has multiple invites and wants a
single dashboard view).

Required server env vars:

```
GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client-secret>
GOOGLE_REDIRECT_URI=https://<host>/auth/google/callback

MAGIC_LINK_SIGNING_SECRET=<32+ byte secret>
MAGIC_LINK_EXPIRES_MINUTES=15

SMTP_HOST=<smtp host>
SMTP_PORT=587
SMTP_USER=<smtp user>
SMTP_PASS=<smtp password>
MAGIC_LINK_FROM_ADDRESS=no-reply@<your-domain>
```

Google App OAuth consent redirect URIs:

- `https://localhost:5000/auth/google/callback` (development)
- `https://<host>/auth/google/callback` (production)

Magic link flow:

1. `POST /auth/magic-link/start` with `{ email }` → look up an `external` user
   row. If missing, refuse (we don't auto-create external users from
   self-service to avoid spam).
2. Sign a JWT containing `{ userId, exp }` with `MAGIC_LINK_SIGNING_SECRET`,
   email it to the user as
   `https://<host>/auth/magic-link/callback?token=...`.
3. Callback verifies the JWT, ensures `active=true`, then issues a session
   cookie just like the Microsoft flow.

Provider mapping for Google:

| Google claim     | User directory field              |
| ---------------- | --------------------------------- |
| `email`          | `email` (lookup key)              |
| `email_verified` | gate: must be `true`              |
| `name`           | `name`                            |
| `sub`            | optional stable id for upsert     |

---

## Server changes required for production

The middleware in `server/routes.ts` is the only place that needs a swap:

```ts
// Today:
const userId = readUserId(req); // from x-rfq-user-id header

// In production:
const userId = req.session?.userId; // from server-issued session cookie
```

Everything below — role / scope / grant derivation, inactive-account 403,
subcontractor dashboard block, document admin-only check, recommendation
permissions — already runs off the user record and stays untouched.

---

## What MUST NOT change

- Token portal routes (`/api/portal/:token`, `/portal/:token` UI) keep working
  without login. The token IS the auth.
- Document confidentiality: PO + pricing quotation stay group_admin only.
- Recommendations remain hidden from factories and subcontractors.
- Cluster scoping for buyer / commercial_staff stays tied to `companyId`.

---

## Preview safety rules

- No `localStorage`, `sessionStorage`, or cookies on the client. Refresh resets
  login on purpose.
- No real email is ever sent.
- No real OAuth secrets are present in the repo or required by the build.
- The `users` table has no password column. Production wires SSO directly; local
  service accounts (if ever added) should hash with Argon2id.

---

## Demo accounts seeded today

| Name                   | Email (style)                                                         | Role               | Provider  | Notes                              |
| ---------------------- | --------------------------------------------------------------------- | ------------------ | --------- | ---------------------------------- |
| Priya Wickramasinghe   | priya.wickramasinghe@theexpertsgroup.onmicrosoft.com                  | group_admin        | microsoft | Full oversight                     |
| Asanka Perera          | asanka.perera@tropicoir.theexpertsgroup.onmicrosoft.com               | commercial_staff   | microsoft | Tropicoir cluster · grant ON       |
| Nuwan Jayasinghe       | nuwan.jayasinghe@euro.theexpertsgroup.onmicrosoft.com                 | commercial_staff   | microsoft | Euro cluster · grant OFF           |
| Dilani Fernando        | dilani.fernando@tropicoir.theexpertsgroup.onmicrosoft.com             | buyer              | microsoft | Tropicoir Lanka                    |
| Ruwan Bandara          | ruwan.bandara@premiertech.theexpertsgroup.onmicrosoft.com             | factory_user       | microsoft | Premier Tech Palai                 |
| Maria Jensen           | maria.jensen@atlas-coir.example                                       | subcontractor_user | google    | External — uses portal token       |
| Inactive Demo User     | inactive.demo@theexpertsgroup.onmicrosoft.com                         | commercial_staff   | microsoft | Demonstrates `active=false` block  |
