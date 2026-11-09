<#
.SYNOPSIS
    Turns the texts captured by the plugin into a clean list of texts that still need a
    reviewed translation.

.DESCRIPTION
    Reads ~/.runelite/translator/untranslated/<language>.txt (written by the plugin when
    "Journals: capture untranslated" is enabled) and removes:

      * duplicates;
      * texts that already have an exact translation in the curated dictionary;
      * texts covered by a "re:" pattern (dynamic texts like "Combat Level 25");
      * keys without letters outside their colour tags (empty labels).

    The result is written to build/pending-<language>.txt, ready to be filled in.

.EXAMPLE
    ./scripts/merge-captures.ps1
    ./scripts/merge-captures.ps1 -Language german
#>
param(
    [string]$Language = "spanish",
    [string]$Source = "$env:USERPROFILE\.runelite\translator\untranslated",
    [string]$TranslationFile = "$PSScriptRoot\..\translations\interface\$Language.txt",
    [string]$Output = "$PSScriptRoot\..\build\pending-$Language.txt"
)

$known = New-Object 'System.Collections.Generic.HashSet[string]'
$patterns = New-Object 'System.Collections.Generic.List[string]'

if (Test-Path $TranslationFile) {
    Get-Content $TranslationFile -Encoding UTF8 | ForEach-Object {
        $line = $_.TrimEnd()
        if ($line -eq '' -or $line.StartsWith('#')) { return }

        $index = $line.IndexOf(';')
        if ($index -le 0) { return }

        $key = $line.Substring(0, $index)
        if ($key.StartsWith('re:')) {
            $patterns.Add($key.Substring(3))
        } else {
            [void]$known.Add($key)

            # some texts end with </col>, others do not: both count as translated
            if (-not $key.Contains('</col>')) {
                [void]$known.Add("$key</col>")
            }

            # tasks also appear in the list without their requirement annotation
            $annotation = $key.IndexOf('<col=ffffff>(')
            if ($annotation -gt 0) {
                [void]$known.Add($key.Substring(0, $annotation))
            }
        }
    }
}

$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$pending = New-Object 'System.Collections.Generic.List[string]'

$sourceFile = Join-Path $Source "$Language.txt"
if (-not (Test-Path $sourceFile)) {
    Write-Host "No capture file yet: $sourceFile"
    exit 0
}

Get-Content $sourceFile -Encoding UTF8 | ForEach-Object {
    $line = $_.TrimEnd()
    if ($line -eq '' -or $line.StartsWith('#')) { return }

    $index = $line.IndexOf(';')
    $key = if ($index -ge 0) { $line.Substring(0, $index) } else { $line }
    if ($key -eq '') { return }

    # labels that are only colour tags, eg. "<col=000000>"
    $plain = [regex]::Replace($key, '<[^>]*>', '')
    if ($plain -notmatch '[A-Za-z]') { return }

    if ($known.Contains($key)) { return }

    # an annotated variant is covered when its task (without requirements) is translated:
    # the plugin appends the original requirements at runtime
    $annotation = $key.IndexOf('<col=ffffff>(')
    if ($annotation -gt 0 -and $known.Contains($key.Substring(0, $annotation))) { return }

    # and vice versa: a task is covered when its annotated variant is translated
    foreach ($candidate in $known) {
        if ($candidate.StartsWith($key) -and $candidate.Substring($key.Length).StartsWith('<col=ffffff>(')) { return }
    }

    foreach ($pattern in $patterns) {
        if ($key -match $pattern) { return }
    }

    if (-not $seen.Add($key)) { return }

    $pending.Add("$key;")
}

$directory = Split-Path $Output -Parent
New-Item -ItemType Directory -Force -Path $directory | Out-Null
[System.IO.File]::WriteAllLines($Output, [string[]]$pending, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "$($pending.Count) texts pending translation"
Write-Host "($($known.Count) exact entries and $($patterns.Count) patterns already cover captured texts)"
Write-Host "written to $Output"
Write-Host ""
Write-Host "Next: translate the right hand side of each line (keep names and skill names in english)"
Write-Host "and append the result to $TranslationFile"
