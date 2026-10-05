# Summarize the spike output: median time to the last callback and actual JPEG size per tier.
$dir = Join-Path $env:TEMP 'cull-remote-spike'
Add-Type -AssemblyName System.Drawing

$rows = Import-Csv (Join-Path $dir 'results.csv')
$final = $rows | Group-Object file, size | ForEach-Object {
  $_.Group | Sort-Object { [int]$_.callback } | Select-Object -Last 1
}

$final | Group-Object size | Sort-Object { [int]$_.Name } | ForEach-Object {
  $ms = $_.Group | ForEach-Object { [int]$_.ms } | Sort-Object
  $callbacks = ($_.Group | ForEach-Object { [int]$_.callback } | Measure-Object -Maximum).Maximum
  $edges = Get-ChildItem $dir -Filter "*_$($_.Name).jpg" | ForEach-Object {
    $img = [System.Drawing.Image]::FromFile($_.FullName)
    [Math]::Max($img.Width, $img.Height)
    $img.Dispose()
  } | Sort-Object
  $kb = (Get-ChildItem $dir -Filter "*_$($_.Name).jpg" | Measure-Object Length -Average).Average / 1KB
  [pscustomobject]@{
    Size         = [int]$_.Name
    Photos       = $ms.Count
    MedianMs     = $ms[[int][Math]::Floor($ms.Count / 2)]
    MaxMs        = $ms[-1]
    MaxCallbacks = $callbacks
    MinLongEdge  = $edges[0]
    AvgKB        = [int]$kb
  }
} | Format-Table -AutoSize

Get-Content (Join-Path $dir 'meta.csv')
