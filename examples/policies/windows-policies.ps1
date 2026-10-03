# EXAMPLE ONLY - review before use. Run as Administrator on a TEST machine first.
#
# Sets VS Code enterprise policies in the registry, the same values Group Policy / Intune
# write from VS Code's ADMX template (<VS Code install>\policies\VSCode.admx).
# Policy names and types were checked against the ADMX shipped with VS Code 1.140.
# In production, prefer deploying the ADMX through GPO or Intune instead of this script.
#
# Replace 'example.native-tool-template' and 'example' with your publisher/extension IDs.

$key = 'HKLM:\Software\Policies\Microsoft\VSCode'
New-Item -Path $key -Force | Out-Null

# Disable global auto-approve AND the Allow-all / Autopilot permission-level bypass.
New-ItemProperty -Path $key -Name 'ChatToolsAutoApprove' -PropertyType DWord -Value 0 -Force | Out-Null

# Always require manual approval for this tool's VS Code confirmation.
# Key format (current VS Code source): '<publisher>.<extension-name>/<toolReferenceName>'.
New-ItemProperty -Path $key -Name 'ChatToolsEligibleForAutoApproval' -PropertyType MultiString -Force `
  -Value '{"example.native-tool-template/createNote": false}' | Out-Null

# Allow only approved extensions and versions. Pin exact versions for controlled releases.
New-ItemProperty -Path $key -Name 'AllowedExtensions' -PropertyType MultiString -Force `
  -Value '{"github.copilot-chat": true, "example.native-tool-template": ["0.1.0"], "*": false}' | Out-Null

# Let IT control VS Code updates (values: none, manual, start, default).
New-ItemProperty -Path $key -Name 'UpdateMode' -PropertyType String -Value 'manual' -Force | Out-Null

Write-Host "Policies written to $key. Restart VS Code; policy-controlled settings show as managed by your organization in the Settings editor."
