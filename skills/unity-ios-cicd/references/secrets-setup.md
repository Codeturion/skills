# Secrets: what to create, where to click, how each is handled

Six secrets make signing and upload work. Walk the user through them one
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

## How the secrets get onto GitHub

**Way A: the agent sets them (recommended when `gh` is logged in).**
The user never touches the GitHub UI and the values never enter the
chat. For each secret, ask the user to save the value to a temp file
(or pipe it), then run:

```bash
gh secret set ASC_KEY_CONTENT -R YOURORG/YOURREPO < AuthKey_XXXX.p8
gh secret set ASC_KEY_ID -R YOURORG/YOURREPO --body "ABC123DEFG"
rm -f AuthKey_XXXX.p8   # remove the local copy once it is stored
```

Passwords the skill invents (`MATCH_PASSWORD`, `CI_KEYCHAIN_PASSWORD`)
need no user step at all: generate and store in one pipe, then show the
user the value once so they can save it in their password manager
(`MATCH_PASSWORD` matters, see section 4):

```bash
openssl rand -base64 24 | tee /dev/tty | gh secret set MATCH_PASSWORD -R YOURORG/YOURREPO
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
   the file somewhere safe (a password manager, not the repo).
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

How to get it: the user invents it. Long and random:

```bash
openssl rand -base64 24
```

Store it in a password manager too. If it is lost, the certs repo is
unreadable and match must start over (`fastlane match nuke` and re-run
the bootstrap).

## 5. `CI_KEYCHAIN_PASSWORD`

What it is: the password for the dedicated CI keychain on the build Mac.
The lanes create and unlock that keychain with it on every run. It
protects local key material on the runner, so it matters less than the
others, but it should still be random.

How to get it: same as above, `openssl rand -base64 24`. It is never
needed outside CI, so the user does not have to remember it.

## 6. Optional: notification webhook

If the user wants a chat message when a build finishes, add a webhook
url (Slack or Discord) as a secret, for example `BUILD_WEBHOOK`, and
keep the notify step in the workflow. Skip it otherwise, the pipeline
does not need it.

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
