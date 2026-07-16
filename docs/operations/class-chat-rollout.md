# Class chat rollout runbook

## Scope and owners

This runbook releases class groups, ordinary campus groups, sticker media, and the optional realtime chat gateway. Run it from a protected deployment workstation. Do not put database credentials, API keys, or chat media source credentials in Git.

## 1. Preflight

1. Confirm a recent database backup and verify the restore procedure.
2. Set production environment variables for the REST service: `DATABASE_URL` or the `MYSQL_*` variables, `AUTH_SECRET`, `SMS_TOKEN_SECRET`, and the media/realtime variables from `.env.example`.
3. Use distinct random values for `CHAT_REALTIME_TOKEN_SECRET` and `CHAT_REALTIME_INTERNAL_SECRET`.
4. Keep `CHAT_REALTIME_URL` empty until the realtime worker health check has passed. The browser will use polling safely during this period.

## 2. Schema and identity preview

Run the schema migration before releasing the REST API:

```powershell
npm.cmd run db:init
npm.cmd run classes:sync -- --dry-run
```

Review the JSON result:

- `identities.plannedGroups` lists proposed groups grouped by school, college, and class.
- `identities.incompleteStudents` must be reviewed before creating mandatory class memberships.
- `sync.changed` is the planned student/class/group repair count.
- `sync.errors` must be empty before applying.

## 3. Approved class synchronization

After a data owner approves the preview, apply the idempotent synchronization:

```powershell
$env:CONFIRM_CLASS_SYNC = "YES"
npm.cmd run classes:sync -- --apply
Remove-Item Env:CONFIRM_CLASS_SYNC
```

The explicit environment confirmation prevents accidental writes. Re-running the command is safe: existing class groups and student assignments are reused.

## 4. Service deployment order

1. Deploy the REST API (Vercel or the selected server platform) with the migrated database settings.
2. Deploy the realtime worker only after the REST API is healthy:

```powershell
npm.cmd run realtime:check
npm.cmd run realtime:deploy
```

3. Copy the worker URL into `CHAT_REALTIME_URL`, set the same realtime secrets in the REST API and worker, then redeploy the REST API.
4. Deploy the static frontend to Cloudflare Pages only after the API origin and CORS settings are validated.
5. Configure R2 media variables before enabling user-made sticker upload. Keep the source allowlist empty until a licensed source adapter is reviewed.

## 5. Production smoke checks

Record the deployed URL, commit SHA, platform build ID, and tester in the release log. Verify:

- one student can see only their mandatory class group;
- one teacher assignment appears in the intended class group;
- an ordinary group requires owner/admin approval for group-number and QR applications;
- duplicate client message retry persists one message;
- polling receives a message when the realtime socket is disconnected;
- frozen-group appeal is available only to the ordinary group owner;
- class group member pages do not expose platform administrators or phone numbers;
- uploaded stickers are served from the configured media origin and rejected when source permission is missing.

## 6. Monitoring and rollback

Monitor REST error rate, database connection failures, realtime worker errors, upload moderation failures, and chat API latency for at least one business day. Preserve audit logs and message records.

For an application rollback, redeploy the previous REST and Pages builds first, leave database schema additive migrations in place, and keep polling enabled. Do not drop chat or class tables as part of an incident rollback. If realtime causes faults, clear `CHAT_REALTIME_URL` and redeploy the REST API; clients will return to polling without losing messages.
