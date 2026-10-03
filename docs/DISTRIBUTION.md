# Distribution, updates and rollback

Researched October 2026 from code.visualstudio.com (`/docs/enterprise/*`,
`/docs/configure/extensions/extension-marketplace`, `/docs/configure/command-line`, the Private
Marketplace announcement of 2025-11-18). Points marked *unverified* could not be confirmed
from official documentation; check them on your VS Code baseline before relying on them.

The GitHub repository is the **source template**. What users install is a **VSIX** built from
a derived repository. VS Code already has the install, update, allow-list and pinning
mechanisms, so the extension contains **no self-update code**.

## What needs which infrastructure

| Capability | Plain VSIX | VS Code policies (GPO/MDM/`policy.json`), no license needed | Private Marketplace (GitHub Enterprise customers) |
|---|---|---|---|
| Install | `code --install-extension x.vsix` or *Install from VSIX…* | Push VSIX with device management; Windows-only *bootstrap* folder | Users install from the Extensions view |
| Automatic updates | **No.** VSIX installs have auto-update disabled | Re-push new VSIX (`--force`) from your tooling | **Yes**, VS Code's normal update mechanism |
| Allow only approved extensions / versions | — | `AllowedExtensions` policy | Plus curation of what the marketplace serves |
| Offline / air-gapped | Yes | Yes | Yes (self-hosted container, can rehost public extensions) |
| Pin VS Code itself | — | `UpdateMode` policy (`update.mode`: `none`, `manual`, `start`, `default`) | — |
| Control AI tool approval | — | `ChatToolsAutoApprove`, `ChatToolsEligibleForAutoApproval`, `ChatAgentExtensionTools`, `ChatAgentMode` | — |

Policies are VS Code features: Windows ADMX/ADML via Group Policy or Intune (registry
`Software\Policies\Microsoft\VSCode`), macOS configuration profiles, Linux
`/etc/vscode/policy.json`. They do not require GitHub Enterprise or a Copilot plan.
Private Marketplace is documented as "currently available to GitHub Enterprise customers";
users sign in with a GitHub Enterprise or Copilot Business/Enterprise account. It is
desktop-only, configured through the `ExtensionGalleryServiceUrl` policy.

## By stage

### Development

Clone the derived repo, `npm install`, press F5. Nothing to distribute. CI (`.github/workflows/ci.yml`)
builds, tests against the minimum and current VS Code, and uploads the VSIX as an artifact.

### Pilot (a few people)

```bash
npm run package
code --install-extension dist/native-tool-template-0.1.0.vsix
```

Share the VSIX from the CI artifact or a GitHub release (the workflow creates one per `v*` tag).
Pilot users update by installing the next VSIX. Fine for weeks, not for hundreds of users.

### Company-wide

Pick one:

1. **Private Marketplace** (if the company has GitHub Enterprise): publish each version to it.
   Users get updates automatically (`extensions.autoUpdate`, default `true`, policy
   `ExtensionsAutoUpdate`). This is the only option that gives true automatic updates
   through VS Code itself.
2. **Device management push** (no extra license): your software-distribution tooling (Intune,
   SCCM, Jamf, Ansible, a login script) runs
   `code --install-extension \\share\tools\company-tool-1.1.0.vsix --force` when the approved
   version changes. Updates are "automatic" from the user's view, but your tooling drives them.
   On Windows, VSIX files in the installation's `bootstrap\extensions` folder are installed on
   first launch only (and not reinstalled if the user removes them).

Plus, in both cases, the `AllowedExtensions` policy to permit only your publisher and approved
versions, and the chat policies from [APPROVAL-AND-SECURITY.md](APPROVAL-AND-SECURITY.md).

### Controlled releases (the company approves specific versions)

```jsonc
// AllowedExtensions policy (same syntax as the extensions.allowed setting)
{
  "github.copilot-chat": true,
  "example.native-tool-template": ["1.0.0", "1.1.0"],  // exact approved versions
  "example": "stable",                                 // any release version from this publisher, no pre-releases
  "*": false                                           // everything else blocked
}
```

`*` is the only wildcard; more specific keys win; a policy overrides the user setting; an
installed extension that becomes disallowed is disabled.

## Who does what

| Question | Answer |
|---|---|
| **Who publishes?** | CI builds the VSIX from a tagged commit (`v1.1.0`). A release owner uploads it to the Private Marketplace or to the distribution share. Builds are reproducible from the tag. |
| **Who approves?** | Platform/security team adds the version to `AllowedExtensions` (and to the marketplace) after review. Review checklist: tool list and categories, `review` policy per mutate tool, `modelDescription` text, CHANGELOG, test results. |
| **Who distributes?** | Private Marketplace, or device-management tooling for VSIX pushes. |
| **Who updates?** | VS Code (marketplace path) or your device-management tooling (VSIX path). Never the extension itself. |
| **Incompatible update?** | If a new version needs a newer VS Code (`engines.vscode`), a marketplace only offers it to compatible clients; a VSIX install fails with a compatibility error and the old version stays. Raise `engines.vscode` only when you need to, and only after the company VS Code baseline has moved. |
| **Pin a version?** | `AllowedExtensions` with an exact version list; `code --install-extension publisher.name@1.0.0` for marketplace installs; pin VS Code itself with `UpdateMode`. |
| **Roll back a bad release?** | Remove the bad version from `AllowedExtensions` (installed copies are disabled), make the previous version available (marketplace: re-publish or let users *Install Specific Version*; VSIX: push the old VSIX with `--force`), then ship a fixed **higher** version. Prefer fixing forward: VS Code updates to the highest allowed version. |

## Publisher identity and signing

- Choose a company-specific `publisher` (e.g. `acme-devtools`) and keep it identical across all
  derived extensions. Extension identity is `publisher.name`.
- **Reserve the publisher ID on the public Visual Studio Marketplace** even if you never publish
  there, so nobody else can publish an extension with the same ID that VS Code might offer as
  an update. *(Recommendation; not from VS Code documentation.)*
- The public Marketplace signs extensions on publish and VS Code verifies the signature
  (`extensions.verifySignature`). Whether privately built VSIX files and Private Marketplace
  extensions are signed or verified: *unverified*. Treat the distribution share or marketplace
  as the trust anchor: restrict write access and publish only from CI.
- Proposed APIs cannot be used by Marketplace-published extensions and only work in Insiders;
  this template uses none.

## Versioning

- SemVer. MAJOR: tool removed or renamed, input schema made incompatible, `engines.vscode` raised
  beyond the company baseline. MINOR: new tool, new optional input field. PATCH: fixes.
- Tool `name`s are API. Agents, prompts and admin policies (`ChatToolsEligibleForAutoApproval`)
  reference them, so renaming is a breaking change.
- Record the template version a derived extension is based on in its CHANGELOG.
