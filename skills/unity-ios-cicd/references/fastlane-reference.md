# Fastlane reference

Three files in the project repo. Replace `com.example.mygame` with the
real bundle id and `YOURTEAMID` with the Apple Team ID (developer.apple.com
-> Membership).

## Gemfile (repo root)

```ruby
source "https://rubygems.org"

gem "fastlane"
```

Run `bundle install` once locally and **commit `Gemfile.lock`**. Without
the lockfile, every CI run installs whatever fastlane released that day,
and a bad release breaks the pipeline on a random Tuesday.

## fastlane/Appfile

```ruby
app_identifier "com.example.mygame"
```

## fastlane/Fastfile

Two lanes. `setup_signing` runs once (and again only if certs expire or
get revoked). `beta` runs on every build. Both build their own CI
keychain from scratch, so a half-broken state from a failed run never
leaks into the next one.

```ruby
# Runs on the self-hosted macOS runner. The Xcode project is exported by
# Unity first (CIBuild.BuildIOS -> build/ios); these lanes only sign and ship.
#
# Required env (GitHub Actions secrets):
#   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_CONTENT  - App Store Connect API key
#   MATCH_GIT_URL, MATCH_PASSWORD               - fastlane match certs repo
#   CI_KEYCHAIN_PASSWORD                        - dedicated CI keychain (headless
#                                                 Mac: the login keychain refuses
#                                                 non-GUI access, so match must
#                                                 use its own keychain)

default_platform(:ios)

XCODE_PROJECT = "build/ios/Unity-iPhone.xcodeproj".freeze
BUNDLE_ID = "com.example.mygame".freeze
TEAM_ID = "YOURTEAMID".freeze
# Name the keychain after the app. One Mac can serve several repos, and the
# lanes delete and recreate this keychain on every run: two repos sharing one
# keychain name would kill each other's keychain mid-build.
KEYCHAIN_NAME = "ci-mygame".freeze

platform :ios do
  desc "One-time bootstrap: generate distribution cert + profile into the certs repo"
  lane :setup_signing do
    api_key = app_store_connect_api_key(
      key_id: ENV.fetch("ASC_KEY_ID"),
      issuer_id: ENV.fetch("ASC_ISSUER_ID"),
      key_content: ENV.fetch("ASC_KEY_CONTENT")
    )

    keychain_password = ENV.fetch("CI_KEYCHAIN_PASSWORD")
    delete_keychain(name: KEYCHAIN_NAME) if File.exist?(File.expand_path("~/Library/Keychains/#{KEYCHAIN_NAME}-db"))
    create_keychain(
      name: KEYCHAIN_NAME,
      password: keychain_password,
      unlock: true,
      # 0 = no auto-lock: a 3600s timeout can relock the keychain
      # mid-codesign on a long cold-Library build (the param is an Integer,
      # false crashes the action)
      timeout: 0,
      lock_when_sleeps: false
    )

    match(
      type: "appstore",
      app_identifier: BUNDLE_ID,
      git_url: ENV.fetch("MATCH_GIT_URL"),
      api_key: api_key,
      readonly: false,
      keychain_name: KEYCHAIN_NAME,
      keychain_password: keychain_password
    )

    # Same pre-approval as the beta lane, so a codesign straight off this
    # keychain also works (see the beta lane for why log: false).
    sh("security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k #{keychain_password.shellescape} ~/Library/Keychains/#{KEYCHAIN_NAME}-db > /dev/null", log: false)
  end

  desc "Sign the Unity-exported Xcode project and upload to TestFlight"
  lane :beta do
    api_key = app_store_connect_api_key(
      key_id: ENV.fetch("ASC_KEY_ID"),
      issuer_id: ENV.fetch("ASC_ISSUER_ID"),
      key_content: ENV.fetch("ASC_KEY_CONTENT")
    )

    keychain_password = ENV.fetch("CI_KEYCHAIN_PASSWORD")
    delete_keychain(name: KEYCHAIN_NAME) if File.exist?(File.expand_path("~/Library/Keychains/#{KEYCHAIN_NAME}-db"))
    create_keychain(
      name: KEYCHAIN_NAME,
      password: keychain_password,
      unlock: true,
      # 0 = no auto-lock: a 3600s timeout can relock the keychain
      # mid-codesign on a long cold-Library build (the param is an Integer,
      # false crashes the action)
      timeout: 0,
      lock_when_sleeps: false
    )

    match(
      type: "appstore",
      app_identifier: BUNDLE_ID,
      git_url: ENV.fetch("MATCH_GIT_URL"),
      api_key: api_key,
      readonly: true,
      keychain_name: KEYCHAIN_NAME,
      keychain_password: keychain_password
    )

    # Headless runner: without an explicit partition list codesign intermittently
    # fails with errSecInternalComponent (key access needs UI approval otherwise).
    # log: false keeps the password out of the build log. Masking alone is
    # not enough: shellescape can alter base64 characters so the logged
    # string no longer matches the masked secret.
    sh("security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k #{keychain_password.shellescape} ~/Library/Keychains/#{KEYCHAIN_NAME}-db > /dev/null", log: false)
    sh("security unlock-keychain -p #{keychain_password.shellescape} ~/Library/Keychains/#{KEYCHAIN_NAME}-db", log: false)

    build_number = latest_testflight_build_number(
      api_key: api_key,
      app_identifier: BUNDLE_ID,
      initial_build_number: 0
    ) + 1
    increment_build_number(build_number: build_number, xcodeproj: XCODE_PROJECT)

    profile_name = "match AppStore #{BUNDLE_ID}"
    update_code_signing_settings(
      path: XCODE_PROJECT,
      targets: ["Unity-iPhone"],
      use_automatic_signing: false,
      team_id: TEAM_ID,
      code_sign_identity: "Apple Distribution",
      profile_name: profile_name
    )

    # Answers the export compliance question. false is correct only for
    # apps that use standard HTTPS and no custom crypto.
    set_info_plist_value(
      path: "build/ios/Info.plist",
      key: "ITSAppUsesNonExemptEncryption",
      value: false
    )

    build_app(
      project: XCODE_PROJECT,
      scheme: "Unity-iPhone",
      configuration: "Release",
      export_method: "app-store",
      output_directory: "build/output",
      export_options: {
        provisioningProfiles: { BUNDLE_ID => profile_name }
      }
    )

    # With skip_waiting + changelog, pilot waits only until the build APPEARS
    # on App Store Connect (sets the notes, skips full processing): a couple
    # of minutes, not the full processing wait.
    notes = ENV["RELEASE_NOTES"].to_s.strip
    upload_to_testflight(
      api_key: api_key,
      skip_waiting_for_build_processing: true,
      changelog: notes.empty? ? nil : notes
    )
  end
end
```

## Why each piece is there

- **Fresh keychain every run**: `delete_keychain` + `create_keychain`
  means a failed run cannot poison the next one. The keychain is cheap
  to rebuild because match restores the certs from the repo.
- **Per-app keychain name**: the fresh-keychain pattern is destructive,
  so the name must be unique per repo when one Mac hosts several
  runners. Two lanes sharing the name `ci` would delete each other's
  keychain mid-codesign, an intermittent failure that looks like the
  partition-list bug but is not.
- **`readonly: true` in beta**: only the bootstrap lane may write to the
  certs repo. Builds can never mutate signing state by accident.
- **`set-key-partition-list`**: on a Mac with no GUI session, macOS wants
  UI approval the first time a tool touches a private key. This command
  pre-approves codesign. Skipping it causes intermittent
  `errSecInternalComponent` failures, the worst kind, because sometimes
  it works.
- **Build number from TestFlight**: the source of truth is what App
  Store Connect already has, plus one. No counter file in the repo, no
  collisions when building from two branches.
- **Manual signing with the match profile**: Unity exports the project
  with automatic signing. `update_code_signing_settings` flips it to the
  exact cert and profile match installed, so the build does not depend
  on Xcode's automatic magic working headless. Only the `Unity-iPhone`
  target needs this; the `UnityFramework` target does not take a
  provisioning profile.
- **`ITSAppUsesNonExemptEncryption`**: without it every TestFlight build
  sits at "Missing Compliance" until someone answers the export question
  in the browser. Setting it to false is correct for apps that use only
  standard HTTPS.
