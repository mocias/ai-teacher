$ErrorActionPreference = 'Stop'
$app = $null
$deck = $null
$previousSecurity = $null
try {
  $app = New-Object -ComObject PowerPoint.Application
  $previousSecurity = $app.AutomationSecurity
  $app.AutomationSecurity = 3
  $deck = $app.Presentations.Open($env:TEACHER_PPT_INPUT, -1, 0, 0)
  $deck.SaveAs($env:TEACHER_PPT_OUTPUT, 32)
} finally {
  if ($deck) { $deck.Close(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($deck) }
  if ($app) {
    if ($null -ne $previousSecurity) { $app.AutomationSecurity = $previousSecurity }
    if ($app.Presentations.Count -eq 0) { $app.Quit() }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
  }
}
