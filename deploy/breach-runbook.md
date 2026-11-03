# Breach runbook

For a suspected leak, loss, or unauthorized access to personal data. This file is public, so keep
incident details out of it. Keep them in a private incident log.

Run commands from the `deploy` folder.

## 1. Contain

1. Start the incident log: time noticed, what you know, and each step you take.
2. Back up `data/postgres` and copy the logs before you change anything. Logs are capped and rotate:
   `docker compose -f compose.staging.yml logs --timestamps > incident-logs.txt`. Keep this copy
   with the incident log, and off the server.
3. If the attacker may still have access, stop the public entry point:
   `docker compose -f compose.staging.yml stop caddy`.

## 2. Scope

Open a database shell:

```sh
docker compose -f compose.staging.yml exec postgres sh -c 'psql -U "$POSTGRES_USER" -d schuly'
```

How many people and records are affected:

```sql
SELECT 'accounts' AS item, count(*) FROM "ApplicationUsers"
UNION ALL SELECT 'school users', count(*) FROM "SchoolUsers"
UNION ALL SELECT 'grades', count(*) FROM "Grades"
UNION ALL SELECT 'absences', count(*) FROM "Absences"
UNION ALL SELECT 'absences with a reason', count(*) FROM "Absences" WHERE "Reason" IS NOT NULL AND "Reason" <> ''
UNION ALL SELECT 'documents', count(*) FROM "StudentDocuments"
UNION ALL SELECT 'stored logins', count(*) FROM "VaultEntries"
UNION ALL SELECT 'Helply conversations', count(*) FROM "HelplyConversations";
```

Which systems the stored logins belong to:

```sql
SELECT "PluginName", count(*) FROM "VaultEntries" GROUP BY 1 ORDER BY 2 DESC;
```

Suspicious sign-in activity, with your own time window:

```sql
SELECT "Kind", "Detail", count(*), count(DISTINCT "UserId") AS accounts, min("OccurredAt"), max("OccurredAt")
FROM "SecurityAuditEntries" WHERE "OccurredAt" >= '2026-01-01T00:00:00Z'
GROUP BY 1, 2 ORDER BY 3 DESC;
```

Everything recorded for one sign-in account, and its email if the account still exists:

```sql
SELECT * FROM "SecurityAuditEntries" WHERE "UserId" = '00000000-0000-0000-0000-000000000000' ORDER BY "OccurredAt";
SELECT "Email", "LastSeenAt" FROM "ApplicationUsers" WHERE "ExternalId" = '00000000-0000-0000-0000-000000000000';
```

## 3. Revoke

```sh
sh revoke-stored-tokens.sh                                        # shows what would be removed
sh revoke-stored-tokens.sh --confirm revoke-all-stored-tokens     # removes it
```

This deletes all stored school and Microsoft logins, Schuly refresh tokens, and MCP tokens and API
keys. Everyone must sign in and reconnect their schools again. It can't be undone without a backup.

It only stops Schuly from using these logins. School and Microsoft tokens that were copied stay valid
at the source until they expire, and OdA Org passwords stay valid until changed. Tell affected users
to change those passwords and end their sessions there.

Then, depending on what leaked:

- **Keys or `.env`:** rotate every key, as described in
  [Rotate keys](../docs/setup/operations.md#rotate-keys). Change the database, S3, and SMTP passwords.
- **A database copy or a backup without keys:** logins and documents stay protected, but school data,
  including absence reasons, is readable.
- **The server itself:** rebuild it from clean images. Don't reuse it.

## 4. Report

- **FDPIC:** report as soon as possible if the breach is likely to create a high risk for the people
  affected (Art. 24 FADP), through the
  [reporting page](https://www.edoeb.admin.ch/en/information-security). Say what happened, when, which
  data, roughly how many people and records, the consequences, and your measures. Data that was
  effectively encrypted, with the key safe, doesn't need a report.
- **Affected people:** tell them if it helps protect them, or if the FDPIC asks. Say what to do, such
  as changing a password.
- **Self-hosted servers:** you are the one responsible for your server and its report.

## 5. Keep the record

Keep the incident log for at least two years (Art. 15(4) DPO), even if you didn't report: what
happened, the effects, and your measures. Don't store it in this repository. Then delete the copied
logs and any backups you no longer need, and restart: `docker compose -f compose.staging.yml up -d`.
