# ==============================================================================
# SmartRec System & Cloud GPU Terminal Monitor
# Real-time dashboard for Cloud GPU, Local Docker & Video Jobs
# 
# Usage in VSCode Terminal:
#   .\monitor.ps1
#   .\monitor.ps1 -Watch
#   .\monitor.ps1 -w -Interval 5
# ==============================================================================

[CmdletBinding()]
param (
    [Alias("w")]
    [switch]$Watch,

    [Alias("i")]
    [int]$Interval = 3
)

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$ESC = [char]27
$C_RESET   = "$ESC" + "[0m"
$C_BOLD    = "$ESC" + "[1m"
$C_DIM     = "$ESC" + "[2m"
$C_RED     = "$ESC" + "[91m"
$C_GREEN   = "$ESC" + "[92m"
$C_YELLOW  = "$ESC" + "[93m"
$C_BLUE    = "$ESC" + "[94m"
$C_MAGENTA = "$ESC" + "[95m"
$C_CYAN    = "$ESC" + "[96m"
$C_WHITE   = "$ESC" + "[97m"

function Get-EnvFile {
    $envPath = Join-Path $PSScriptRoot ".env"
    $envMap = @{}
    if (Test-Path $envPath) {
        Get-Content $envPath | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
                $idx = $line.IndexOf("=")
                $k = $line.Substring(0, $idx).Trim()
                $v = $line.Substring($idx + 1).Trim()
                $envMap[$k] = $v
            }
        }
    }
    return $envMap
}

$script:CachedGpuUrl = ""
$script:LastGpuUrlCheck = [DateTime]::MinValue

function Get-ActiveGpuUrl {
    param($envMap)
    $now = [DateTime]::UtcNow
    if ($script:CachedGpuUrl -and (($now - $script:LastGpuUrlCheck).TotalSeconds -lt 15)) {
        return $script:CachedGpuUrl
    }

    $gistId = $envMap["CLOUD_GPU_REGISTRY_GIST_ID"]
    $ghToken = $envMap["CLOUD_GPU_REGISTRY_GITHUB_TOKEN"]
    if ($gistId) {
        try {
            $headers = @{
                "User-Agent" = "smartrec-monitor"
                "Accept"     = "application/vnd.github+json"
            }
            if ($ghToken) {
                $headers["Authorization"] = "Bearer $ghToken"
            }
            $resp = Invoke-RestMethod -Uri "https://api.github.com/gists/$gistId" -Headers $headers -TimeoutSec 4 -ErrorAction Stop
            if ($resp.files -and $resp.files."gpu_url.txt") {
                $content = $resp.files."gpu_url.txt".content.Trim()
                if ($content.StartsWith("https://")) {
                    $script:CachedGpuUrl = $content.TrimEnd("/")
                    $script:LastGpuUrlCheck = $now
                    return $script:CachedGpuUrl
                }
            }
        } catch {}
    }
    $url = $envMap["CLOUD_GPU_URL"]
    if ($url) {
        $script:CachedGpuUrl = $url.Trim().TrimEnd("/")
        $script:LastGpuUrlCheck = $now
        return $script:CachedGpuUrl
    }
    return ""
}

function Make-ProgressBar {
    param(
        [double]$percent,
        [int]$length = 20
    )
    $filled = [int][Math]::Round($length * ($percent / 100.0))
    if ($filled -lt 0) { $filled = 0 }
    if ($filled -gt $length) { $filled = $length }
    $empty = $length - $filled

    $color = $C_GREEN
    if ($percent -ge 85) { $color = $C_RED }
    elseif ($percent -ge 65) { $color = $C_YELLOW }

    $bar = ("#" * $filled) + ("-" * $empty)
    return ($color + "[" + $bar + "]" + $C_RESET)
}

$script:SupportsStats = $null

function Get-GpuMetrics {
    param($gpuUrl)
    if (-not $gpuUrl) {
        return @{ Status = "NO_URL" }
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $headers = @{ "ngrok-skip-browser-warning" = "true" }

    # Neu da tung loi 404 thi khong spam /stats nua, goi thang /health
    if ($script:SupportsStats -eq $false) {
        try {
            $health = Invoke-RestMethod -Uri "$gpuUrl/health" -Headers $headers -TimeoutSec 4 -ErrorAction Stop
            $sw.Stop()
            $dev = if ($health.device) { $health.device } else { "cuda" }
            return @{
                Status = "ONLINE"
                LatencyMs = [Math]::Round($sw.Elapsed.TotalMilliseconds, 0)
                Device = $dev
                IsDetailed = $false
            }
        } catch {
            $sw.Stop()
            return @{ Status = "OFFLINE"; Error = $_.Exception.Message }
        }
    }

    # Uu tien goi /stats
    try {
        $stats = Invoke-RestMethod -Uri "$gpuUrl/stats" -Headers $headers -TimeoutSec 4 -ErrorAction Stop
        $sw.Stop()
        $script:SupportsStats = $true
        $dev = if ($stats.device) { $stats.device } else { "cuda" }
        return @{
            Status = "ONLINE"
            LatencyMs = [Math]::Round($sw.Elapsed.TotalMilliseconds, 0)
            Device = $dev
            SystemRam = $stats.system_ram
            GpuRam = $stats.gpu_ram
            Disk = $stats.disk
            IsDetailed = $true
        }
    } catch {
        # Neu 404 thi nho lai de lan sau chi goi /health
        $script:SupportsStats = $false
        try {
            $health = Invoke-RestMethod -Uri "$gpuUrl/health" -Headers $headers -TimeoutSec 4 -ErrorAction Stop
            $sw.Stop()
            $dev = if ($health.device) { $health.device } else { "cuda" }
            return @{
                Status = "ONLINE"
                LatencyMs = [Math]::Round($sw.Elapsed.TotalMilliseconds, 0)
                Device = $dev
                IsDetailed = $false
            }
        } catch {
            $sw.Stop()
            return @{ Status = "OFFLINE"; Error = $_.Exception.Message }
        }
    }
}

function Get-DockerStatus {
    try {
        $raw = docker ps -a --format "{{.Names}}`t{{.Status}}`t{{.Ports}}" 2>$null
        $list = @()
        foreach ($line in ($raw -split "`n")) {
            $trimmed = $line.Trim()
            if (-not $trimmed) { continue }
            $parts = $trimmed -split "`t"
            if ($parts[0] -match "smartrec-") {
                $p2 = if ($parts.Length -gt 2) { $parts[2] } else { "" }
                $p1 = if ($parts.Length -gt 1) { $parts[1] } else { "" }
                $list += [PSCustomObject]@{
                    Name = $parts[0]
                    Status = $p1
                    Ports = $p2
                }
            }
        }
        return $list
    } catch {
        return @()
    }
}

function Get-VideoJobs {
    try {
        $sql = "SELECT json_agg(t) FROM (SELECT pj.id AS job_id, COALESCE(mf.original_name, m.title, 'Video') AS video_name, pj.status, pj.current_stage, pj.created_at, CASE WHEN pj.status IN ('PROCESSING', 'RUNNING') THEN ROUND(EXTRACT(EPOCH FROM (NOW() - pj.created_at))::numeric, 1) ELSE ROUND(EXTRACT(EPOCH FROM (COALESCE(pj.failed_at, pj.updated_at) - pj.created_at))::numeric, 1) END AS duration_sec FROM processing_jobs pj LEFT JOIN media_file mf ON pj.media_file_id = mf.id LEFT JOIN meetings m ON pj.meeting_id = m.id ORDER BY pj.created_at DESC LIMIT 6) t;"
        $jsonStr = docker exec smartrec-postgres psql -U postgres -d smartrec_db -t -A -c "$sql" 2>$null
        if ($jsonStr -and $jsonStr.Trim()) {
            return ($jsonStr | ConvertFrom-Json)
        }
    } catch {}
    return @()
}

function Render-Dashboard {
    $envMap = Get-EnvFile
    $gpuUrl = Get-ActiveGpuUrl -envMap $envMap
    $gpuInfo = Get-GpuMetrics -gpuUrl $gpuUrl
    $containers = Get-DockerStatus
    $jobs = Get-VideoJobs

    $nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $modeStr = if ($Watch) { $C_GREEN + "[LIVE " + $Interval + "s]" + $C_RESET } else { $C_DIM + "[Snapshot]" + $C_RESET }
    
    Write-Host ""
    Write-Host ($C_BOLD + $C_CYAN + "================================================================================" + $C_RESET)
    Write-Host ($C_BOLD + $C_CYAN + "             SMARTREC SYSTEM & CLOUD GPU REAL-TIME MONITOR" + $C_RESET)
    Write-Host ("             Thoi gian: " + $C_YELLOW + $nowStr + $C_RESET + "  |  Che do: " + $modeStr)
    Write-Host ($C_BOLD + $C_CYAN + "================================================================================" + $C_RESET)

    # 1. CLOUD GPU
    Write-Host ""
    Write-Host ($C_BOLD + $C_WHITE + "[1] CLOUD GPU SERVER (Google Colab - Tesla T4)" + $C_RESET)
    if (-not $gpuUrl) {
        Write-Host ("   " + $C_RED + "* Trang thai : CHUA CAU HINH GIST_ID HOAC CLOUD_GPU_URL TRONG .env" + $C_RESET)
    } elseif ($gpuInfo.Status -eq "OFFLINE") {
        Write-Host ("   " + $C_RED + "* Trang thai : OFFLINE / MAT KET NOI" + $C_RESET)
        Write-Host ("     URL        : " + $C_DIM + $gpuUrl + $C_RESET)
        Write-Host ("     " + $C_YELLOW + "(Hay mo tab Google Colab va bam Run lai o code server)" + $C_RESET)
    } else {
        $lat = $gpuInfo.LatencyMs
        $latColor = if ($lat -lt 250) { $C_GREEN } elseif ($lat -lt 650) { $C_YELLOW } else { $C_RED }
        Write-Host ("   " + $C_GREEN + "* Trang thai : ONLINE" + $C_RESET + " (Phan hoi: " + $latColor + $lat + "ms" + $C_RESET + ")")
        Write-Host ("     Thiet bi   : " + $C_BOLD + $C_CYAN + $gpuInfo.Device.ToUpper() + $C_RESET)
        Write-Host ("     URL Server : " + $C_CYAN + $gpuUrl + $C_RESET)

        if ($gpuInfo.IsDetailed) {
            $gram = $gpuInfo.GpuRam
            if ($gram) {
                $gName = if ($gram.name) { $gram.name } else { "Tesla T4" }
                $gUsed = [double]$gram.used_gb
                $gTot  = [double]$gram.total_gb
                $gPct  = [double]$gram.percent
                $gBar  = Make-ProgressBar -percent $gPct -length 20
                Write-Host ("     GPU RAM    : " + $gBar + "  " + $C_BOLD + $gUsed + " / " + $gTot + " GB" + $C_RESET + " (" + $gPct + "%)  [" + $gName + "]")
            }

            $sram = $gpuInfo.SystemRam
            if ($sram) {
                $sUsed = [double]$sram.used_gb
                $sTot  = [double]$sram.total_gb
                $sPct  = [double]$sram.percent
                $sBar  = Make-ProgressBar -percent $sPct -length 20
                Write-Host ("     System RAM : " + $sBar + "  " + $C_BOLD + $sUsed + " / " + $sTot + " GB" + $C_RESET + " (" + $sPct + "%)")
            }

            $dsk = $gpuInfo.Disk
            if ($dsk) {
                $dUsed = [double]$dsk.used_gb
                $dTot  = [double]$dsk.total_gb
                $dPct  = [double]$dsk.percent
                $dBar  = Make-ProgressBar -percent $dPct -length 20
                Write-Host ("     Disk       : " + $dBar + "  " + $C_BOLD + $dUsed + " / " + $dTot + " GB" + $C_RESET + " (" + $dPct + "%)")
            }
        } else {
            Write-Host ("     Model AI   : " + $C_GREEN + "Da nap san sang tren GPU Tesla T4" + $C_RESET)
            Write-Host ("     " + $C_DIM + "(Colab hien tai chua co endpoint /stats - Cap nhat code de xem RAM/GPU/Disk chi tiet)" + $C_RESET)
        }
    }

    # 2. LOCAL DOCKER
    Write-Host ""
    Write-Host ($C_BOLD + $C_WHITE + "[2] HE THONG DOCKER LOCAL" + $C_RESET)
    if ($containers.Count -eq 0) {
        Write-Host ("   " + $C_YELLOW + "(Chua co container SmartRec nao dang chay)" + $C_RESET)
    } else {
        foreach ($c in ($containers | Sort-Object Name)) {
            $name = $c.Name.PadRight(23)
            $st = $c.Status
            if ($st.StartsWith("Up")) {
                Write-Host ("   " + $C_GREEN + "[OK] " + $C_RESET + $name + " : " + $C_GREEN + $st + $C_RESET)
            } elseif ($st.Contains("Restarting")) {
                Write-Host ("   " + $C_YELLOW + "[..] " + $C_RESET + $name + " : " + $C_YELLOW + $st + $C_RESET)
            } else {
                Write-Host ("   " + $C_RED + "[--] " + $C_RESET + $name + " : " + $C_DIM + $st + $C_RESET)
            }
        }
    }

    # 3. VIDEO JOBS
    Write-Host ""
    Write-Host ($C_BOLD + $C_WHITE + "[3] TIEN TRINH XU LY VIDEO & DIARIZATION (PENDING -> PROCESSING -> DONE)" + $C_RESET)
    
    if (-not $jobs -or $jobs.Count -eq 0) {
        Write-Host ("   " + $C_DIM + "(Chua co tac vu xu ly video nao trong CSDL)" + $C_RESET)
    } else {
        Write-Host "   +------------------------------+--------------------+--------------+-----------------+"
        Write-Host "   | TEN VIDEO / CUOC HOP         | TRANG THAI         | GIAI DOAN    | THOI GIAN XU LY |"
        Write-Host "   +------------------------------+--------------------+--------------+-----------------+"

        foreach ($job in $jobs) {
            $rawName = [string]$job.video_name
            if ($rawName.Length -gt 28) {
                $rawName = $rawName.Substring(0, 25) + "..."
            }
            $vName = $rawName.PadRight(28)

            $stRaw = [string]$job.status
            $stage = if ($job.current_stage) { [string]$job.current_stage } else { "--" }
            $stageStr = $stage.PadRight(12)

            $sec = if ($job.duration_sec -ne $null) { [double]$job.duration_sec } else { 0.0 }
            
            $stFormatted = ""
            $timeFormatted = ""

            if ($stRaw -match "COMPLETED|DONE|SUCCEEDED") {
                $stFormatted = ($C_GREEN + "* DONE (Hoan tat)" + $C_RESET).PadRight(18 + $C_GREEN.Length + $C_RESET.Length)
                $timeFormatted = ($C_BOLD + $C_GREEN + $sec + "s" + $C_RESET).PadRight(15 + $C_BOLD.Length + $C_GREEN.Length + $C_RESET.Length)
            } elseif ($stRaw -match "PROCESSING|RUNNING") {
                $stFormatted = ($C_CYAN + "> PROCESSING" + $C_RESET).PadRight(18 + $C_CYAN.Length + $C_RESET.Length)
                $timeFormatted = ($C_CYAN + $sec + "s (running)" + $C_RESET).PadRight(15 + $C_CYAN.Length + $C_RESET.Length)
            } elseif ($stRaw -match "PENDING|QUEUED") {
                $stFormatted = ($C_YELLOW + ". PENDING" + $C_RESET).PadRight(18 + $C_YELLOW.Length + $C_RESET.Length)
                $timeFormatted = ($C_YELLOW + "Cho worker" + $C_RESET).PadRight(15 + $C_YELLOW.Length + $C_RESET.Length)
            } elseif ($stRaw -match "FAILED|DLQ") {
                $stFormatted = ($C_RED + "! FAILED" + $C_RESET).PadRight(18 + $C_RED.Length + $C_RESET.Length)
                $timeFormatted = ($C_RED + $sec + "s" + $C_RESET).PadRight(15 + $C_RED.Length + $C_RESET.Length)
            } else {
                $stFormatted = ($C_DIM + "- " + $stRaw + $C_RESET).PadRight(18 + $C_DIM.Length + $C_RESET.Length)
                $timeFormatted = ($C_DIM + $sec + "s" + $C_RESET).PadRight(15 + $C_DIM.Length + $C_RESET.Length)
            }

            Write-Host ("   | " + $vName + " | " + $stFormatted + " | " + $stageStr + " | " + $timeFormatted + " |")
        }
        Write-Host "   +------------------------------+--------------------+--------------+-----------------+"
    }

    Write-Host ""
    Write-Host ($C_BOLD + $C_CYAN + "================================================================================" + $C_RESET)
}

if (-not $Watch) {
    Render-Dashboard
    exit 0
}

Write-Host "Dang khoi dong che do giam sat Real-time... Nhan Ctrl + C de thoat."
Clear-Host
try {
    while ($true) {
        try {
            [Console]::SetCursorPosition(0, 0)
        } catch {
            Clear-Host
        }
        Render-Dashboard
        Start-Sleep -Seconds $Interval
    }
} catch {
    Write-Host "`nDa dung giam sat."
}
