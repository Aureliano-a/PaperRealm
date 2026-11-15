# Generates bundled dictionaries from application UI phrases only, never user books.
$ErrorActionPreference = 'Stop'
$keys = @(Get-Content -Raw -Encoding UTF8 'work-ui-strings.json' | ConvertFrom-Json)
$locales = [ordered]@{ en='en'; ja='ja'; es='es'; ru='ru' }
$output = [ordered]@{}
if (Test-Path 'src/ui-translations.json') {
  $existing = Get-Content -Raw -Encoding UTF8 'src/ui-translations.json' | ConvertFrom-Json
  foreach ($locale in $locales.Keys) {
    $output[$locale] = [ordered]@{}
    if ($existing.$locale) { foreach ($property in $existing.$locale.PSObject.Properties) { $output[$locale][$property.Name] = $property.Value } }
  }
}
function Translate-Phrases([string[]]$items, [string]$target) {
  $query = [uri]::EscapeDataString(($items -join "`n"))
  $url = "https://translate.google.com/translate_a/single?client=gtx&sl=zh-CN&tl=$target&dt=t&q=$query"
  for ($attempt=0; $attempt -lt 4; $attempt++) {
    try {
      $data = Invoke-RestMethod -Uri $url -TimeoutSec 30
      $translated = (($data[0] | ForEach-Object { $_[0] }) -join '')
      $lines = @($translated -split "`n", 0, 'SimpleMatch')
      if ($lines.Count -eq $items.Count) { return ,$lines }
      if ($items.Count -eq 1) { return ,@($translated.Trim()) }
      $mid=[int][math]::Floor($items.Count / 2)
      $a=Translate-Phrases $items[0..($mid-1)] $target
      $b=Translate-Phrases $items[$mid..($items.Count-1)] $target
      return ,@($a + $b)
    } catch {
      if ($attempt -eq 3) { throw }
      Start-Sleep -Seconds ($attempt + 1)
    }
  }
}
foreach ($locale in $locales.Keys) {
  $dictionary = if ($output.Contains($locale)) { $output[$locale] } else { [ordered]@{} }
  $chunks = [System.Collections.Generic.List[object]]::new()
  $current = [System.Collections.Generic.List[string]]::new(); $chars=0
  foreach ($key in $keys) {
    if ($dictionary.Contains($key)) { continue }
    if ($current.Count -gt 0 -and ($chars + $key.Length -gt 1000 -or $current.Count -ge 50)) {
      $chunks.Add($current.ToArray()); $current=[System.Collections.Generic.List[string]]::new(); $chars=0
    }
    $current.Add($key); $chars += $key.Length
  }
  if ($current.Count) { $chunks.Add($current.ToArray()) }
  foreach ($chunk in $chunks) {
    $values=Translate-Phrases $chunk $locales[$locale]
    for ($i=0; $i -lt $chunk.Count; $i++) { $dictionary[$chunk[$i]] = $values[$i] }
  }
  $output[$locale]=$dictionary
  $output | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 'src/ui-translations.json'
  Write-Output "$locale translated: $($dictionary.Count) phrases"
}
