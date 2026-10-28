$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot 'android/app/src/main/AndroidManifest.xml'
if (-not (Test-Path $path)) {
    throw "AndroidManifest.xml not found at $path"
}

$content = Get-Content -Path $path -Raw
if ($content -notmatch 'android\.permission\.INTERNET') {
    $permission = '    <uses-permission android:name="android.permission.INTERNET" />' + [Environment]::NewLine + '    <application'
    $content = $content.Replace('<application', $permission)
}
if ($content -notmatch 'android\.permission\.RECORD_AUDIO') {
    $permission = '    <uses-permission android:name="android.permission.RECORD_AUDIO" />' + [Environment]::NewLine + '    <application'
    $content = $content.Replace('<application', $permission)
}
Set-Content -Path $path -Value $content -Encoding utf8
Write-Host 'Android INTERNET and RECORD_AUDIO permissions are present.'
