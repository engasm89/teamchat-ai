# Tenant-isolated database transaction contract

The app must verify the Firebase ID token server-side, resolve its UID to active membership via an *allowlisted privileged UID lookup*, then use a **restricted non-owner, non-BYPASSRLS runtime role**.

For every operation:

```sql
BEGIN;
SELECT set_config('app.tenant_id', $1, true); -- $1 comes from verified server membership ONLY
-- parameterized tenant-scoped SQL goes here
COMMIT; -- or ROLLBACK on error
```

Do not issue commands outside this scoped transaction; do not use session-local tenant state across pooled connections. The shared runtime role does not own the schema. Configure `GRANT USAGE ON SCHEMA teamchat` plus narrowly scoped table privileges during controlled provisioning. Run migrations/seeds separately as owner. A tenant-supplied string from websocket/HTTP/Gemini is never passed to `set_config`. Verify user/room membership within the transaction (RLS only prevents cross-tenant access; room authorization is additional).

**Not yet proven:** schema has not been run against a live PostgreSQL server or role-hardened via IAM. This file is a contract, not a successful integration test.
