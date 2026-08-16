# 生成本地应用图标（无需网络）：PNG 多尺寸 + ICO（PNG 内嵌）+ ICNS
Add-Type -AssemblyName System.Drawing

$outDir = "d:\code\OneFlower\src-tauri\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-IconBitmap([int]$s) {
    $b = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($b)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    # 背景：纯色
    $g.Clear([System.Drawing.Color]::FromArgb(109, 76, 219))
    # 简约"花"：中心圆 + 五瓣
    $cx = $s / 2; $cy = $s / 2
    $white = [System.Drawing.Brushes]::White
    $petalR = [double]($s * 0.16)
    $orbit = [double]($s * 0.26)
    for ($i = 0; $i -lt 5; $i++) {
        $ang = $i * (2 * [Math]::PI / 5) - [Math]::PI / 2
        $px = $cx + $orbit * [Math]::Cos($ang)
        $py = $cy + $orbit * [Math]::Sin($ang)
        $g.FillEllipse($white, [single]($px - $petalR), [single]($py - $petalR), [single]($petalR * 2), [single]($petalR * 2))
    }
    $core = [System.Drawing.Color]::FromArgb(255, 237, 213)
    $coreBrush = New-Object System.Drawing.SolidBrush($core)
    $coreR = [double]($s * 0.13)
    $g.FillEllipse($coreBrush, [single]($cx - $coreR), [single]($cy - $coreR), [single]($coreR * 2), [single]($coreR * 2))
    $g.Dispose()
    return $b
}

function Save-Png($bmp, $path) {
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "PNG: $path"
}

# PNG 尺寸
$png256 = New-IconBitmap 256
Save-Png $png256 "$outDir\icon.png"
Save-Png (New-IconBitmap 32) "$outDir\32x32.png"
Save-Png (New-IconBitmap 128) "$outDir\128x128.png"
Save-Png (New-IconBitmap 256) "$outDir\128x128@2x.png"

# ---------- ICO（内嵌 PNG 的 Vista+ 格式）----------
$ms = New-Object System.IO.MemoryStream
$png256.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms.ToArray()

$icoPath = "$outDir\icon.ico"
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
# ICONDIR: reserved(2)=0, type(2)=1, count(2)=1
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
# ICONDIRENTRY: width(1)=0(256), height(1)=0, colors(1)=0, reserved(1)=0, planes(2)=1, bpp(2)=32, size(4), offset(4)=22
$bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length); $bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Flush(); $bw.Close()
Write-Host "ICO: $icoPath"

# ---------- ICNS（ic08 = 256x256 PNG 包裹）----------
$icnsPath = "$outDir\icon.icns"
$typeBytes = [System.Text.Encoding]::ASCII.GetBytes("icns")
$chunkType = [System.Text.Encoding]::ASCII.GetBytes("ic08")
$chunkLen = 8 + $pngBytes.Length
$total = 8 + $chunkLen
$fs2 = [System.IO.File]::Create($icnsPath)
$bw2 = New-Object System.IO.BinaryWriter($fs2)
$bw2.Write($typeBytes)
$bw2.Write([UInt32]$total)  # BinaryWriter 写 UInt32 为小端，需手动大端
$bw2.Close()

# ICNS 长度为大端，重写
$all = New-Object System.IO.MemoryStream
$all.Write($typeBytes, 0, 4)
$all.Write([BitConverter]::GetBytes([UInt32]$total)[3..0], 0, 4)  # 反转成大端
$all.Write($chunkType, 0, 4)
$all.Write([BitConverter]::GetBytes([UInt32]$chunkLen)[3..0], 0, 4)
$all.Write($pngBytes, 0, $pngBytes.Length)
[System.IO.File]::WriteAllBytes($icnsPath, $all.ToArray())
Write-Host "ICNS: $icnsPath"

Write-Host "DONE"
