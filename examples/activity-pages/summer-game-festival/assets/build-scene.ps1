# 只提取顶部复杂场景，并用邻近无字纹理移除需由 React 承载的 UI。
# 不包含任务、按钮、账户文字。坐标全部按原图缩放到 390px 标定。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot '..\reference.jpg'))
$scale = 1260 / 390
$scene = [System.Drawing.Bitmap]::new(1260, [int](245 * $scale))
$g = [System.Drawing.Graphics]::FromImage($scene)
$g.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, 1260, $scene.Height), [System.Drawing.Rectangle]::new(0, 0, 1260, $scene.Height), [System.Drawing.GraphicsUnit]::Pixel)
function Patch-Texture($x, $y, $w, $h, $sx, $sy, $sourceHeight = $h, $ellipse = $false) {
  $dest = [System.Drawing.Rectangle]::new([int]($x*$scale), [int]($y*$scale), [int]($w*$scale), [int]($h*$scale))
  $src = [System.Drawing.Rectangle]::new([int]($sx*$scale), [int]($sy*$scale), [int]($w*$scale), [int]($sourceHeight*$scale))
  if ($ellipse) { $clip = [System.Drawing.Drawing2D.GraphicsPath]::new(); $clip.AddEllipse($dest); $g.SetClip($clip) }
  $g.DrawImage($source, $dest, $src, [System.Drawing.GraphicsUnit]::Pixel)
  if ($ellipse) { $g.ResetClip(); $clip.Dispose() }
}
# 顶部账户/返回、右侧圆入口：仅覆盖含 UI 的边界。
Patch-Texture 14 10 20 21 38 10
Patch-Texture 271 10 108 24 271 0 8
Patch-Texture 342 50 37 34 349 125 34 $true
Patch-Texture 343 86 37 34 349 159 34 $true
# 联动标题位于场景下沿。保留人物中段，其余改为页面原生夜幕色。
$night = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#100d35'))
$g.FillRectangle($night, 0, [int](209*$scale), [int](276*$scale), [int](36*$scale)+2)
$g.FillRectangle($night, [int](276*$scale), [int](209*$scale), [int](114*$scale)+2, [int](36*$scale)+2)
$output = Join-Path $PSScriptRoot '..\..\..\activity-target\public\game-festival\hero-scene.png'
$scene.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
$night.Dispose(); $g.Dispose(); $scene.Dispose(); $source.Dispose()
