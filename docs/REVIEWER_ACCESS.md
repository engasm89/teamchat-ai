# Reviewer access: retrieving and delivering the six passwords

This file holds no secrets. It tells Ashraf where the reviewer passwords are and how to hand them over.

## Where they are

The six passwords exist in one place: the macOS login keychain of the machine that rotated them.

- Keychain service: `teamchat-ai-reviewer`
- Keychain account: the reviewer's sign-in address, for example `northside.buyer1@teamchat.internal`

| Chain | Sign-in addresses |
| --- | --- |
| Northside Outfitters | `northside.buyer1@teamchat.internal`, `northside.buyer2@teamchat.internal`, `northside.analyst3@teamchat.internal` |
| Valley Home Goods | `valley.buyer1@teamchat.internal`, `valley.buyer2@teamchat.internal`, `valley.analyst3@teamchat.internal` |

They were rotated on 12 October 2026 by `scripts/handoff/rotate-passwords.ts` (run `qa_evidence/runs/20261012T053119Z-rotation-6d7970`). That run proved each new password signs in, each old password is rejected, and every session opened before the rotation is refused. Every password written down before then, in reports, drafts, scratch files or earlier agent transcripts, no longer works.

## Retrieving them

Either open **Keychain Access**, search for `teamchat-ai-reviewer`, open an item and tick **Show password**, or copy one straight to the clipboard without displaying it:

```sh
security find-generic-password -s teamchat-ai-reviewer -a northside.buyer1@teamchat.internal -w | tr -d '\n' | pbcopy
```

macOS asks for the login password the first time. Clear the clipboard afterwards (copy something else).

Before sending, confirm they still work: sign in at https://focus-clean-4b9f4.web.app with one Northside and one Valley account, or run the handoff check, which needs `cloud-sql-proxy --port 6543` running:

```sh
node --experimental-strip-types scripts/handoff/run-handoff.ts
```

## Delivering them

Send the passwords separately from the submission e-mail, so that one forwarded or leaked message never holds both the URL and the credentials.

1. Put the six address and password pairs into a one-time, expiring share from a password manager (for example a 1Password item share or a Bitwarden Send), set to expire within a few days and, if offered, to the recipient's address only.
2. Send the share link to Gonzalo in a separate message from the submission e-mail, and say so in the submission e-mail.
3. Ask him to confirm he can open it, and once he does, record that delivery happened: set `"done": true` on `HUMAN-CREDENTIAL-DELIVERY` in `docs/requirements/checks.json` and regenerate the matrix (`node --experimental-strip-types scripts/validate-matrix.ts`).

Never paste passwords into the repository, the README, an issue, a commit message, a screenshot, or a chat with an AI assistant.

## If they need to change again

```sh
FIREBASE_PROJECT_ID=focus-clean-4b9f4 node --experimental-strip-types scripts/handoff/rotate-passwords.ts
```

The script writes each new password to Keychain before Firebase changes, revokes every existing session, and checks the old password is dead. Afterwards, `scripts/handoff/scan-credentials.ts <path>` reports any file under `<path>` that contains one of the current passwords, without printing them.
