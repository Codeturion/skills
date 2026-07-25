# Secrets: what to create, where to click, how each is handled

Apple moves its web UI around. If a click path below does not match
what the user sees, do not stall: search the page for the key words
(Integrations, Keys, Identifiers) and carry on; the concepts do not
change.

Seven secrets make signing and upload work. Walk the user through them one
at a time, in this order. For each one this file says: what it is, how to
get it, and how it is stored.

Handling rules that apply to all of them:

- Every secret lives in **GitHub encrypted secrets**. GitHub encrypts
  them at rest and masks them in logs.
- Nothing secret is ever committed to the project repo. Certificates
  live in a separate private repo, and even there they are encrypted.
- The user creates the values (only they can log into App Store
  Connect). Storing them on GitHub can go two ways; ask the user which
  they prefer.
- **Ask about chat privacy before the first secret exists** (interview
  question 10). The default is: values never enter the chat. Never ask
  the user to paste a secret into the chat. Both ways below work
  without it: values move file -> GitHub or browser -> GitHub. If the
  user volunteers a value in the chat anyway, store it, tell them it
  passed through the conversation, and show them how to rotate it
  (section 7).

## How the secrets get onto GitHub

**Way A: the agent sets them (recommended when `gh` is logged in).**
The user never touches the GitHub UI and the values never enter the
chat. For each secret, ask the user to save the value to a temp file
(or pipe it), then run:

```bash
gh secret set ASC_KEY_CONTENT -R YOURORG/YOURREPO < AuthKey_XXXX.p8
gh secret set ASC_KEY_ID -R YOURORG/YOURREPO --body "ABC123DEFG"
gh secret list -R YOURORG/YOURREPO   # confirm they landed BEFORE deleting
rm -f AuthKey_XXXX.p8   # only after the list shows the secret
```

Secrets are write-only: once stored they cannot be read back to check.
So always verify with `gh secret list` (right repo, right names, fresh
timestamps) before deleting a one-shot file like the .p8. If the set
went to the wrong repo and the file is already gone, the recovery is
revoke and regenerate the key (section 1).

Passwords the skill invents (`MATCH_PASSWORD`, `CI_KEYCHAIN_PASSWORD`)
need no user step at all. Do NOT print them to the terminal (that puts
the value in the transcript, the exact thing the privacy rule
forbids). Generate to a file, store from the file, then have the USER
open the file themselves to save it in their password manager:

```bash
openssl rand -base64 24 > match_password.txt
gh secret set MATCH_PASSWORD -R YOURORG/YOURREPO < match_password.txt
gh secret list -R YOURORG/YOURREPO
# now ask the user to run:  open -e match_password.txt
# they save the value in their password manager, then: rm match_password.txt
```

Check `gh auth status` first. If `gh` is missing or logged into the
wrong account, fall back to Way B.

**Way B: the user pastes them in the browser.** Repo Settings ->
Secrets and variables -> Actions -> New repository secret. Name must
match the table exactly, value is pasted as is (multiline is fine).

Either way, verify at the end with `gh secret list -R YOURORG/YOURREPO`
(names and dates only, values are never readable back).

If a secret value does pass through the chat by accident, finish the
setup, then suggest revoking and recreating that one.

## 0. The app record (not a secret, but do it first)

Before any key exists, the app must exist in App Store Connect. Guide
the user:

1. First register the bundle id: developer.apple.com -> Certificates,
   Identifiers & Profiles -> Identifiers -> **+** -> App IDs -> App.
   Description: the app name. Bundle ID: **explicit**, reverse-DNS,
   for example `com.studioname.gamename`. Capabilities: default is
   fine for a plain game, but if the app uses Push Notifications, Game
   Center, in-app purchases, or Sign in with Apple, tick those now.
   Adding a capability later invalidates the provisioning profile;
   the fix is re-running the Signing setup workflow, but knowing that
   beats a mystery failure. Register.
2. Then the app: appstoreconnect.apple.com -> My Apps -> **+** ->
   New App. Platform iOS. Name: what players see, unique across the
   whole App Store (add a word if taken). Bundle ID: pick the one just
   registered. SKU: any internal code, `gamename-ios` is fine, users
   never see it.
3. Verify the match yourself: the bundle id in
   `ProjectSettings/ProjectSettings.asset` (`applicationIdentifier`)
   must equal the one just chosen, character for character. Fix Unity
   Player Settings now if not. A mismatch shows up hours later as a
   signing error.

## 1. App Store Connect API key (3 secrets)

What it is: a .p8 key file that lets Fastlane talk to App Store Connect
(create certs, read build numbers, upload builds). It replaces logging
in with an Apple ID and survives 2FA.

How to get it:

1. Go to appstoreconnect.apple.com -> Users and Access ->
   **Integrations** tab -> App Store Connect API -> Team Keys.
2. Click **+** (Generate API Key). Name: `ci`. Access: **App Manager**.
   Admin also works but grants more than needed.
3. Download the `.p8` file. **The download works exactly once.** Store
   the file somewhere safe (a password manager, not the repo). If the
   file is lost, nothing is broken: revoke that key and generate a new
   one, it takes a minute.
4. Note the **Key ID** (on the key row) and the **Issuer ID** (top of
   the page).

GitHub secrets to create:

| Secret | Value |
|---|---|
| `ASC_KEY_ID` | the Key ID, about 10 characters |
| `ASC_ISSUER_ID` | the Issuer ID, a UUID |
| `ASC_KEY_CONTENT` | the full text of the .p8 file, including the BEGIN and END lines |

For `ASC_KEY_CONTENT`, the user pastes the file content as is, with real
line breaks: `cat AuthKey_XXXX.p8 | pbcopy` on a Mac, then paste.

## 2. Certificates repo + `MATCH_GIT_URL`

What it is: fastlane match stores the distribution certificate and
provisioning profile in a git repo, encrypted with a password you
choose. Every machine that signs pulls from this repo, so certificates
never live loose on a laptop.

How to set it up:

1. Create a **new private GitHub repo**, for example `ios-certs`. Empty
   is fine, no README needed.
2. GitHub secret `MATCH_GIT_URL` = the SSH url,
   `git@github.com:YOURORG/ios-certs.git`. Use the SSH form, the deploy
   key below only works over SSH.

## 3. Deploy key -> `MATCH_DEPLOY_KEY`

What it is: an SSH key that gives the runner write access to the certs
repo and nothing else. Better than a personal token, which would grant
all repos.

How to get it (run on any machine):

```bash
ssh-keygen -t ed25519 -f match_deploy_key -N "" -C "match deploy key"
```

With `gh`, the agent can do the whole thing (Way A):

```bash
gh repo deploy-key add match_deploy_key.pub -R YOURORG/ios-certs \
  --title "ci runner" --allow-write
gh secret set MATCH_DEPLOY_KEY -R YOURORG/YOURREPO < match_deploy_key
gh secret list -R YOURORG/YOURREPO   # confirm before deleting the key files
rm -f match_deploy_key match_deploy_key.pub
```

Write access is needed because match pushes new certs on the first run.

By hand (Way B): certs repo Settings -> Deploy keys -> Add deploy key,
paste `match_deploy_key.pub`, check **Allow write access**. Then create
the `MATCH_DEPLOY_KEY` secret in the **project repo** with the content
of the private file, all lines. Delete both local files after.

The workflow writes this key to a temp file and points git at it via
`GIT_SSH_COMMAND` (see workflow-reference.md).

## 4. `MATCH_PASSWORD`

What it is: the password match uses to encrypt everything in the certs
repo. Whoever has repo access still cannot read the certs without it.

How to get it: generate it, long and random (in Way A the agent
generates and stores it in one pipe, see above):

```bash
openssl rand -base64 24
```

The user must store it in a password manager. If it is lost, the certs
repo is unreadable and match must start over.

**Warning about `fastlane match nuke`**: it does not just clean the
repo, it REVOKES certificates on the Apple developer account,
team-wide. Every other app or pipeline signing with that team's
distribution certificate breaks at its next build. Never run it
without telling the user exactly that and getting an explicit yes.
For a lost password with certs still valid on Apple's side, prefer
emptying the certs repo and importing the existing cert with
`fastlane match import`, or re-running `setup_signing`; nuke is the
last resort.

## 5. `CI_KEYCHAIN_PASSWORD`

What it is: the password for the dedicated CI keychain on the build Mac.
The lanes create and unlock that keychain with it on every run. It
protects local key material on the runner, so it matters less than the
others, but it should still be random.

How to get it: same as above, `openssl rand -base64 24`. It is never
needed outside CI, so the user does not have to remember it.

## 6. Optional: remote content host credentials

Only if the project ships remote Addressables content (interview
question 9): `CONTENT_ACCESS_KEY_ID` and `CONTENT_SECRET_ACCESS_KEY`,
an access key pair for the bucket the content lives in. The user
creates it in their host's dashboard (S3: IAM access key scoped to the
bucket; R2: R2 API token). Store both like every other secret. The
upload step is in workflow-reference.md.

## Optional: notification webhook

If the user wants a chat message when a build finishes, add a webhook
url (Slack or Discord) as a secret, for example `BUILD_WEBHOOK`, and
keep the notify step in the workflow. Skip it otherwise, the pipeline
does not need it.

## 7. Rotating a secret

If a value leaked (pasted in a chat, in a log, on a screen share),
rotate it. None of these hurt the pipeline for more than a minute:

- **ASC API key**: revoke it on the Users and Access -> Integrations
  page, generate a new one, update the three `ASC_*` secrets.
- **Deploy key**: remove it from the certs repo, generate a new pair,
  add the new public key, update `MATCH_DEPLOY_KEY`.
- **`MATCH_PASSWORD`**: run `fastlane match change_password`, then
  update the secret.
- **`CI_KEYCHAIN_PASSWORD`**: just set a new value; the lanes rebuild
  the keychain from scratch every run.

## Checklist before Phase 4

All of these exist as Actions secrets in the project repo:

- [ ] `ASC_KEY_ID`
- [ ] `ASC_ISSUER_ID`
- [ ] `ASC_KEY_CONTENT`
- [ ] `MATCH_GIT_URL`
- [ ] `MATCH_DEPLOY_KEY`
- [ ] `MATCH_PASSWORD`
- [ ] `CI_KEYCHAIN_PASSWORD`

And on the Apple side:

- [ ] The app exists in App Store Connect with the right bundle id.
- [ ] The certs repo exists, is private, and has the deploy key with
      write access.
