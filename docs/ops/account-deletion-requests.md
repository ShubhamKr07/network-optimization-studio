# Account deletion requests (emailed GDPR erasure)

A user whose terms acceptance is out of date is signed out and cannot use in-app
"Delete account"; the Privacy Notice tells them to email the privacy contact. The owner
handles those with `pnpm delete-account` (`artifacts/api-server/src/migrations/deleteAccount.ts`),
which calls the same `deleteAccountData` as `DELETE /api/auth/account`: it deletes the
user's solve jobs, scenarios and user row, and WatBot conversations, messages, feedback
and reports go with the user row (cascade). Nothing else deletes accounts.

## 1. Verify the requester

Delete only when the request comes **from the account's own email address**, or the
requester has replied from it to a confirmation you sent. A request from any other
address proves nothing; do not act on it.

## 2. Run it where DATABASE_URL already exists (no password in any transcript)

Dashboard, nos-api service, **Shell** tab (no SSH key needed; the service's
`DATABASE_URL` is already in that shell's environment, so nothing is pasted or typed):

```bash
cd /app/artifacts/api-server        # the image's WORKDIR is /app; adjust if the shell opens elsewhere
pnpm delete-account --email <address>
```

The script prints the database host (never credentials), then a preview: account email
and id, and counts of scenarios, solve jobs, WatBot conversations, messages, feedback
and reports. Check the preview matches the requester. The email match is
case-insensitive, same as log-in. **No `--confirm` means nothing is deleted.**

Then delete:

```bash
pnpm delete-account --email <address> --confirm <same address>
```

| Exit | Meaning |
|---|---|
| 0 | deleted |
| 10 | preview only (no `--confirm`, or it did not match `--email`); nothing deleted |
| 20 | busy: a solve is queued or running; nothing deleted, retry in a few minutes |
| 30 | no account with that email |
| 2 / 1 | usage error / `DATABASE_URL` missing |

Never copy the production connection string to your laptop to run this. Use `render psql`
only for read-only checks.

## 3. Reply within one month

GDPR gives one month from receipt. Reply from the privacy contact address confirming
deletion (or that no account was found).

## 4. What the script does not reach

Handle these per the Privacy Notice, separately:

- PostHog (person and events for that user): delete the person in PostHog.
- Sentry: events are scrubbed of personal data and IP storage is off; delete any issue
  that carries the address if one is found.
- Anthropic (WatBot question text sent as model input): retained under Anthropic's own
  terms; cannot be deleted from here.
- Resend (transactional email logs) and Render database backups: age out on the
  providers' own retention schedules.
- Anonymous `feedback` rows carry no user link and are not deletable by account.
