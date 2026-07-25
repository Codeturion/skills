# Self-hosted runner setup

Goal: a GitHub Actions runner on the build Mac, running as a service,
with labels the workflows can target.

## 1. Get the runner package

In the GitHub repository: Settings -> Actions -> Runners -> New
self-hosted runner -> macOS -> arm64. GitHub shows download and config
commands with a fresh registration token. Use those exact commands, but
put the runner in a folder named after the repo, so one Mac can serve
many repos:

```bash
mkdir ~/actions-runner-mygame && cd ~/actions-runner-mygame
# curl + tar commands from the GitHub page go here
```

## 2. Configure with labels

```bash
./config.sh --url https://github.com/YOURORG/YOURREPO --token <TOKEN> \
  --name mac-builder --labels unity --unattended
```

- The runner gets `self-hosted` and `macOS` automatically. `--labels unity`
  adds the third one. Workflows target
  `runs-on: [self-hosted, macOS, unity]`.
- The token from the GitHub page expires after about an hour. If config
  fails with a token error, get a fresh one from the same page.

## 3. Install as a service

```bash
./svc.sh install
./svc.sh start
./svc.sh status
```

This creates a LaunchAgent (a plist in `~/Library/LaunchAgents/`) that
starts the runner at login and restarts it if it dies. Check it is alive:

```bash
launchctl list | grep actions.runner
```

A LaunchAgent runs only while the user is logged in. On a build Mac,
enable automatic login (System Settings -> Users & Groups) and stop the
Mac from sleeping (System Settings -> Energy, or
`sudo pmset -a sleep 0 displaysleep 10`).

Be honest with the user about what this means: automatic login means
anyone at the machine is in that account without a password, and the
runner keeps the Mac awake around the clock. Fine for a build box in a
drawer, wrong for a daily machine. Two warnings:

- **FileVault defeats automatic login.** After any reboot or power cut
  the Mac stops at the pre-boot unlock screen and the runner stays dead
  until someone types the password. On a headless box, either accept
  that reboots need a manual unlock, or leave FileVault off and rely on
  physical security.
- **Daily machine or laptop? Use daily-machine mode instead**: skip
  automatic login and the `pmset` change entirely. The runner still
  works whenever the user is logged in; builds just do not run while
  the machine is asleep or logged out. Tell the user builds will eat 10
  to 40 minutes of full CPU while they work, and a closed laptop lid
  means no builds. That trade is usually right for a daily machine.

## 4. The PATH trap (read this)

The runner service starts from launchd. launchd does not run
`~/.zprofile` or `~/.zshrc`, so anything Homebrew installed (ruby,
fastlane, jq, rclone) is missing from PATH inside jobs. Do not fix this
by editing the plist. Fix it per workflow, first step after checkout:

```yaml
- name: Add Homebrew tools to PATH (launchd services skip ~/.zprofile)
  run: |
    echo "/opt/homebrew/opt/ruby/bin" >> "$GITHUB_PATH"
    echo "/opt/homebrew/bin" >> "$GITHUB_PATH"
```

Why per workflow: it is visible in the repo, survives runner reinstalls,
and works the same on any Mac that joins later.

## 5. Ruby and Fastlane

Apple's system ruby is too old and blocks gem installs. Use Homebrew
ruby and a Gemfile in the repo root:

```bash
brew install ruby
```

```ruby
# Gemfile
source "https://rubygems.org"

gem "fastlane"
```

Workflows then run `bundle install && bundle exec fastlane ...`. Never
`sudo gem install`.

## 6. Smoke workflow

Add this and run it before anything else. To run it: repo page on
github.com -> **Actions** tab -> pick the workflow on the left -> **Run
workflow** button.

```yaml
name: runner-smoke
on: workflow_dispatch
jobs:
  smoke:
    runs-on: [self-hosted, macOS, unity]
    steps:
      - name: Toolchain report
        run: |
          uname -m
          xcodebuild -version
          ls /Applications/Unity/Hub/Editor/
```

Green means: runner online, labels match, Xcode and Unity visible. If it
never starts, the labels in `runs-on` do not match the runner's labels
(check Settings -> Actions -> Runners).

## Teardown

To cleanly undo everything this skill set up (machine sold, project
dead, or moving to a new Mac):

```bash
cd ~/actions-runner-mygame
./svc.sh stop && ./svc.sh uninstall
./config.sh remove --token <fresh-token-from-the-runners-page>
security delete-keychain ci-mygame   # your KEYCHAIN_NAME from the Fastfile
sudo pmset -a sleep 10               # restore sleep (value is in MINUTES)
# if Screen Sharing was enabled for the setup, turn it off again:
sudo launchctl unload -w /System/Library/LaunchDaemons/com.apple.screensharing.plist
```

Then: disable automatic login (System Settings -> Users & Groups),
revoke the ASC API key (Users and Access -> Integrations), remove the
deploy key from the certs repo, and delete the repo's Actions secrets.
Moving to a new Mac instead? Nothing Apple-side changes: install a
runner on the new machine, run the same workflows, and match restores
the certs from the repo on the first build.

## Security notes for self-hosted runners

- Use the runner only for your own private repos. On a public repo, a
  fork PR could run code on your Mac. If the repo must be public,
  restrict Actions so workflows do not run on fork PRs
  (Settings -> Actions -> General).
- Anyone with push access to the repo can edit a workflow and run
  arbitrary code on the Mac, and read the secrets. Fine solo; with
  collaborators, protect the workflows with environment rules or
  required reviews.
- The runner user account needs no admin rights for builds.
