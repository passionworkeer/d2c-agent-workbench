# 裁取复杂舞台，移除所有进度、入口标签、气泡和喂食控件；这些区域由 React 重建。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot '..\reference.jpg'))
$scale = 1260 / 390
$top = 133
$scene = [System.Drawing.Bitmap]::new(1260, [int](497 * $scale))
$g = [System.Drawing.Graphics]::FromImage($scene)
$g.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, 1260, $scene.Height), [System.Drawing.Rectangle]::new(0, [int]($top*$scale), 1260, $scene.Height), [System.Drawing.GraphicsUnit]::Pixel)
function Patch-Texture($x,$y,$w,$h,$sx,$sy,$sw=$w,$sh=$h) {
  $dest=[System.Drawing.Rectangle]::new([int]($x*$scale),[int](($y-$top)*$scale),[int]($w*$scale),[int]($h*$scale))
  $src=[System.Drawing.Rectangle]::new([int]($sx*$scale),[int]($sy*$scale),[int]($sw*$scale),[int]($sh*$scale))
  $patch=[System.Drawing.Bitmap]::new($dest.Width,$dest.Height)
  $pg=[System.Drawing.Graphics]::FromImage($patch)
  $pg.DrawImage($source,[System.Drawing.Rectangle]::new(0,0,$dest.Width,$dest.Height),$src,[System.Drawing.GraphicsUnit]::Pixel)
  $pg.Dispose()
  # 纹理边缘 3 CSS px 羽化，保持原始背景连续，不留下矩形拼接边。
  for($py=0;$py -lt $patch.Height;$py++){ for($px=0;$px -lt $patch.Width;$px++){
    $edge=[Math]::Min([Math]::Min($px,$patch.Width-1-$px),[Math]::Min($py,$patch.Height-1-$py))
    if($edge -lt 3*$scale){ $color=$patch.GetPixel($px,$py); $alpha=[int](255*$edge/(3*$scale)); $patch.SetPixel($px,$py,[System.Drawing.Color]::FromArgb($alpha,$color)) }
  }}
  $g.DrawImage($patch,$dest.X,$dest.Y,$dest.Width,$dest.Height)
  $patch.Dispose()
}
function Clear-Region($x,$y,$w,$h,$color) {
  $brush=[System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($color))
  $g.FillRectangle($brush,[int]($x*$scale),[int](($y-$top)*$scale),[int]($w*$scale)+1,[int]($h*$scale)+1)
  $brush.Dispose()
}
Patch-Texture 37 144 316 90 37 234 316 1
Patch-Texture 253 253 51 54 201 257
Patch-Texture 5 311 52 49 61 309
Patch-Texture 5 376 51 47 65 378
Patch-Texture 334 312 56 48 321 365
Patch-Texture 275 325 51 52 221 315
Patch-Texture 327 438 63 80 272 380 63 53
Patch-Texture 172 531 48 14 220 531
Patch-Texture 123 550 147 45 272 550 4 45
# 下沿只去除按钮本身，保留两侧复杂舞台金边，避免把舞台截成水平色块。
Clear-Region 98 603 194 27 '#ab1500'
Clear-Region 0 627 80 3 '#ab1500'
Clear-Region 312 625 78 5 '#ab1500'
Patch-Texture 13 610 74 20 0 589 74 20
$output=Join-Path $PSScriptRoot '..\..\..\activity-target\public\pet-red-packet\stage-scene.png'
$scene.Save($output,[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $scene.Dispose(); $source.Dispose()
