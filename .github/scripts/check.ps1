# 봉누도2 기록 검사 — 사건 노트 ↔ 일지 표 ↔ 인물·세력·목록 노트가 서로 맞는지, 깨진 링크가 없는지 본다.
#   쓰는 법: powershell -ExecutionPolicy Bypass -File .github/scripts/check.ps1 [-Vault <볼트 경로>]
#   [오류]가 하나라도 있으면 종료 코드 1, 아니면 0. [경고]는 종료 코드에 영향 없음.
#   Windows PowerShell 5.1과 PowerShell 7(GitHub Actions) 모두에서 돈다.
param([string]$Vault = "")

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
if (-not $Vault) { $Vault = Join-Path $PSScriptRoot "..\.." }
$Vault = (Resolve-Path $Vault).Path.TrimEnd('\', '/')

$script:Errors = New-Object System.Collections.Generic.List[string]
$script:Warnings = New-Object System.Collections.Generic.List[string]
function Err($file, $msg) { $script:Errors.Add("[오류] $file — $msg") }
function Warn($file, $msg) { $script:Warnings.Add("[경고] $file — $msg") }

# ── 파일 읽기 ──
$skipTop = @("99 템플릿", ".obsidian", ".quartz", ".git", ".github", ".trash")
$allFiles = Get-ChildItem -Path $Vault -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($Vault.Length).TrimStart('\', '/') -replace '\\', '/'
  [pscustomobject]@{ Rel = $rel; Full = $_.FullName; Name = $_.Name }
} | Where-Object { ($skipTop -notcontains $_.Rel.Split('/')[0]) -and ($_.Rel -ne "CLAUDE.md") }
# 첨부 파일 이름 (이미지 등 링크 확인용)
$assetNames = @{}
foreach ($f in $allFiles) { if ($f.Name -notmatch '\.md$') { $assetNames[$f.Name] = $true } }

function Unquote([string]$s) {
  $s = $s.Trim()
  if ($s.Length -ge 2 -and (($s[0] -eq '"' -and $s[-1] -eq '"') -or ($s[0] -eq "'" -and $s[-1] -eq "'"))) {
    return $s.Substring(1, $s.Length - 2)
  }
  return $s
}
# 한 줄 목록 [a, "b", c] 를 쉼표로 나눈다 (따옴표 안의 쉼표는 무시)
function SplitList([string]$s) {
  $items = New-Object System.Collections.Generic.List[string]
  $cur = ""; $q = $null
  foreach ($ch in $s.ToCharArray()) {
    if ($q) { if ($ch -eq $q) { $q = $null }; $cur += $ch }
    elseif ($ch -eq '"' -or $ch -eq "'") { $q = $ch; $cur += $ch }
    elseif ($ch -eq ',') { if ($cur.Trim() -ne "") { $items.Add((Unquote $cur)) }; $cur = "" }
    else { $cur += $ch }
  }
  if ($cur.Trim() -ne "") { $items.Add((Unquote $cur)) }
  return ,$items.ToArray()
}
# frontmatter → 해시테이블 (값은 문자열 또는 문자열 배열), 본문
function ParseNote([string]$text) {
  $fm = @{}; $body = $text
  $m = [regex]::Match($text, '^﻿?---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|$)(.*)$', 'Singleline')
  if ($m.Success) {
    $body = $m.Groups[2].Value
    $key = $null
    foreach ($line in ($m.Groups[1].Value -split "\r?\n")) {
      $km = [regex]::Match($line, '^([^\s:#\-][^:]*):\s*(.*)$')
      if ($km.Success) {
        $key = $km.Groups[1].Value.Trim(); $val = $km.Groups[2].Value.Trim()
        if ($val -eq "") { $fm[$key] = "" }
        elseif ($val -match '^\[(.*)\]$') { $fm[$key] = SplitList $matches[1] }
        else { $fm[$key] = Unquote $val }
      } elseif ($key -and $line -match '^\s+-\s*(.*)$') {
        $item = Unquote $matches[1]
        if ($fm[$key] -is [array]) { $fm[$key] = @($fm[$key]) + @($item) } else { $fm[$key] = @($item) }
      }
    }
  }
  return @{ Front = $fm; Body = $body }
}
function Scalar($fm, $k) {
  if (-not $fm.ContainsKey($k)) { return "" }
  $v = $fm[$k]
  if ($v -is [array]) { if ($v.Count -gt 0) { return [string]$v[0] } else { return "" } }
  return [string]$v
}
function ListOf($fm, $k) {
  if (-not $fm.ContainsKey($k)) { return ,@() }
  $v = $fm[$k]
  if ($v -is [array]) { return ,@($v) }
  if ([string]$v -eq "") { return ,@() }
  return ,@([string]$v)
}
# 글에서 [[링크]] 대상(표시 이름·제목 부분 제외)을 순서대로
$linkRe = [regex]'\[\[([^\]\|#]+?)(?:#[^\]\|]*)?(?:\\?\|[^\]]*)?\]\]'
function LinkTargets([string]$s) {
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($m in $linkRe.Matches($s)) { $out.Add($m.Groups[1].Value.TrimEnd('\').Trim()) }
  return ,$out.ToArray()
}
function Norm([string]$s) { return ((Unquote ($s -replace '\\\|', '|')) -replace '\s+', ' ').Trim() }
function NormName([string]$s) { return ($s -replace '[\s\-]', '') }

# ── 노트 읽기 ──
$notes = @()
foreach ($f in $allFiles) {
  if ($f.Name -notmatch '\.md$') { continue }
  $text = [System.IO.File]::ReadAllText($f.Full, [System.Text.Encoding]::UTF8)
  $p = ParseNote $text
  $notes += [pscustomobject]@{
    Rel = $f.Rel; Path = $f.Rel -replace '\.md$', ''; Name = ($f.Name -replace '\.md$', '')
    Folder = $(if ($f.Rel.Contains('/')) { $f.Rel.Substring(0, $f.Rel.LastIndexOf('/')) } else { "" })
    Text = $text; Front = $p.Front; Body = $p.Body
  }
}
$byPath = @{}; $byName = @{}; $byAlias = @{}
foreach ($n in $notes) {
  $byPath[$n.Path] = $n
  if (-not $byName.ContainsKey($n.Name)) { $byName[$n.Name] = @() }
  $byName[$n.Name] += $n
  foreach ($a in (ListOf $n.Front 'aliases')) {
    if (-not $byAlias.ContainsKey($a)) { $byAlias[$a] = @() }
    $byAlias[$a] += $n
  }
}
# 링크 대상 → 노트 (경로 → 파일명 → 별칭 순). 없으면 $null
function Resolve([string]$t) {
  if ($t -eq "") { return $null }
  if ($byPath.ContainsKey($t)) { return $byPath[$t] }
  $base = $t; if ($t.Contains('/')) { $base = $t.Substring($t.LastIndexOf('/') + 1) }
  if ($byName.ContainsKey($base)) { return $byName[$base][0] }
  if ($byAlias.ContainsKey($base)) { return $byAlias[$base][0] }
  return $null
}
function ResolveAll($targets) {
  $out = @()
  foreach ($t in $targets) { $r = Resolve $t; if ($r) { $out += $r.Path } else { $out += "?" + $t } }
  return ,$out
}
function LinksTo($note, $target) {
  foreach ($t in (LinkTargets $note.Text)) { $r = Resolve $t; if ($r -and $r.Path -eq $target.Path) { return $true } }
  return $false
}

# ── 1. 깨진 링크 ──
foreach ($n in $notes) {
  $seen = @{}
  foreach ($t in (LinkTargets $n.Text)) {
    if ($seen.ContainsKey($t)) { continue }; $seen[$t] = $true
    if (Resolve $t) { continue }
    $base = $t; if ($t.Contains('/')) { $base = $t.Substring($t.LastIndexOf('/') + 1) }
    if ($assetNames.ContainsKey($base)) { continue }
    Err $n.Rel "깨진 링크 [[${t}]]"
  }
}

# ── 2. 일지 표 읽기 ──
$gradeSpan = @{ "📰 사건" = "bn-lv-news"; "🔥 특종" = "bn-lv-scoop"; "☕ 일상" = "" }
$gradeTag = @{ "📰 사건" = "사건"; "🔥 특종" = "특종"; "☕ 일상" = "" }
$days = @{}   # N → @{ Note; Rows }
foreach ($n in $notes) {
  if ($n.Folder -ne "01 일지" -or $n.Name -notmatch '^(\d+)일차$') { continue }
  $dn = [int]$matches[1]
  if ((Scalar $n.Front '일차') -ne "$dn") { Err $n.Rel "frontmatter 일차가 $dn 이 아님: '$(Scalar $n.Front '일차')'" }
  $rows = @(); $i = 0
  foreach ($line in ($n.Body -split "\r?\n")) {
    $l = $line.Trim()
    if (-not $l.StartsWith('|')) { continue }
    $i++
    if ($i -le 2) { continue }   # 머리줄·구분줄
    $cells = [regex]::Split($l, '(?<!\\)\|')
    if ($cells.Count -lt 7) { Err $n.Rel "표 행의 칸이 5개가 아님: $l"; continue }
    $c = @(); for ($k = 1; $k -le 5; $k++) { $c += $cells[$k].Trim() }
    $kind = "daily"; $time = $c[0]
    $sm = [regex]::Match($c[0], '<span class="(bn-lv-\w+)">(.*?)</span>')
    if ($sm.Success) {
      $time = $sm.Groups[2].Value.Trim()
      switch ($sm.Groups[1].Value) { "bn-lv-news" { $kind = "news" } "bn-lv-scoop" { $kind = "scoop" } "bn-lv-event" { $kind = "event" } default { Err $n.Rel "모르는 등급 이름표 $($sm.Groups[1].Value)" } }
    }
    $ev = LinkTargets $c[1]
    $target = $null; if ($ev.Count -gt 0) { $target = Resolve $ev[0] }
    if (-not $target) { Err $n.Rel "사건 칸이 노트를 가리키지 않음: $($c[1])"; continue }
    $rows += [pscustomobject]@{
      Day = $dn; Kind = $kind; Time = $time; Target = $target; Summary = (Norm $c[2])
      Related = (ResolveAll (LinkTargets $c[3])); Source = (Norm $c[4]); Line = $l
    }
  }
  $days[$dn] = @{ Note = $n; Rows = $rows }
}
$eventList = $byPath["01 일지/사건 목록"]
if (-not $eventList) { Err "01 일지/사건 목록.md" "없음" }
foreach ($dn in ($days.Keys | Sort-Object)) {
  $d = $days[$dn].Note
  if ($eventList -and $eventList.Text -notmatch [regex]::Escape("![[${dn}일차]]")) { Err $eventList.Rel "![[${dn}일차]] 없음" }
  if ($days.ContainsKey($dn - 1)) {
    $prev = $days[$dn - 1].Note
    if (-not ($d.Text -match [regex]::Escape("[[$($dn - 1)일차"))) { Warn $d.Rel "이전 일지 링크 [[$($dn - 1)일차]] 없음" }
    if (-not ($prev.Text -match [regex]::Escape("[[${dn}일차"))) { Warn $prev.Rel "다음 일지 링크 [[${dn}일차]] 없음" }
  }
  # 표의 사건 행은 파일 번호 순
  $nums = @()
  foreach ($r in $days[$dn].Rows) { if ($r.Target.Name -match '^\d+일차-(\d+) ') { $nums += [int]$matches[1] } }
  for ($k = 1; $k -lt $nums.Count; $k++) { if ($nums[$k] -lt $nums[$k - 1]) { Warn $d.Rel "표 행이 사건 번호 순이 아님 ($($nums[$k-1]) 뒤에 $($nums[$k]))"; break } }
}
if ($eventList) {
  # 사건 목록은 최신 일차가 위
  $order = @(); foreach ($m in [regex]::Matches($eventList.Text, '!\[\[(\d+)일차\]\]')) { $order += [int]$m.Groups[1].Value }
  for ($k = 1; $k -lt $order.Count; $k++) { if ($order[$k] -gt $order[$k - 1]) { Warn $eventList.Rel "최신 일차가 위에 오도록 정렬되지 않음"; break } }
}

# ── 3. 사건 노트 ↔ 일지 표 ──
$caseNotes = $notes | Where-Object { $_.Folder -match '^01 일지/사건/(\d+)일차$' }
$eventNotes = $notes | Where-Object { $_.Folder -eq "01 일지/이벤트" }
$people = $notes | Where-Object { $_.Folder -eq "02 인물" -and $_.Name -ne "인물 목록" }
$factions = $notes | Where-Object { $_.Folder -match '^03 세력/(기관|갱|사업체)$' }
$meetings = @{}   # 인물 Path → 일차 목록
$factionCases = @{}  # 세력 Path → 사건 노트 목록
$validGrade = @("📰 사건", "🔥 특종", "☕ 일상")
$validStatus = @("진행중", "종결", "미궁")
foreach ($c in $caseNotes) {
  $dn = [int]([regex]::Match($c.Folder, '(\d+)일차$').Groups[1].Value)
  if ($c.Name -notmatch '^(\d+)일차-(\d{2}) .+$') { Err $c.Rel "파일명이 'N일차-NN 제목' 꼴이 아님"; continue }
  if ([int]$matches[1] -ne $dn) { Err $c.Rel "파일명의 일차가 폴더($dn 일차)와 다름" }
  $fm = $c.Front
  if ((Scalar $fm '일차') -ne "$dn") { Err $c.Rel "frontmatter 일차가 $dn 이 아님: '$(Scalar $fm '일차')'" }
  $dl = LinkTargets (Scalar $fm '일지'); if ($dl.Count -eq 0 -or $dl[0] -ne "${dn}일차") { Err $c.Rel "일지 속성이 [[${dn}일차]]가 아님" }
  $grade = Scalar $fm '취재가치'
  if ($validGrade -notcontains $grade) { Err $c.Rel "취재가치가 비었거나 모르는 값: '$grade'" }
  $tags = ListOf $fm 'tags'
  if ($gradeTag.ContainsKey($grade)) {
    $want = $gradeTag[$grade]
    foreach ($t in @("사건", "특종")) {
      if ($t -eq $want -and $tags -notcontains $t) { Err $c.Rel "취재가치 $grade 인데 tags에 $t 없음" }
      if ($t -ne $want -and $tags -contains $t) { Err $c.Rel "취재가치 $grade 인데 tags에 $t 있음" }
    }
  }
  $st = Scalar $fm '상태'; if ($st -ne "" -and $validStatus -notcontains $st) { Warn $c.Rel "상태 값이 목록에 없음: '$st'" }
  if ((Scalar $fm '시간') -notmatch '^\d{2}:\d{2}$') { Err $c.Rel "시간이 HH:MM 꼴이 아님: '$(Scalar $fm '시간')'" }
  if ((Scalar $fm '요약') -eq "") { Err $c.Rel "요약이 비었음" }
  $rel = @(); $relPeople = @()
  foreach ($t in (ListOf $fm '관련인물')) {
    $lt = LinkTargets $t; if ($lt.Count -eq 0) { Err $c.Rel "관련인물 항목이 링크가 아님: $t"; continue }
    $r = Resolve $lt[0]
    if (-not $r) { Err $c.Rel "관련인물 [[${t}]] 노트 없음"; $rel += "?" + $lt[0]; continue }
    if ($r.Folder -ne "02 인물") { Err $c.Rel "관련인물 [[$($lt[0])]]이 02 인물 노트가 아님" }
    $rel += $r.Path; $relPeople += $r.Path
  }
  foreach ($t in (ListOf $fm '관련세력')) {
    $lt = LinkTargets $t; if ($lt.Count -eq 0) { Err $c.Rel "관련세력 항목이 링크가 아님: $t"; continue }
    $r = Resolve $lt[0]
    if (-not $r) { Err $c.Rel "관련세력 [[${t}]] 노트 없음"; $rel += "?" + $lt[0]; continue }
    if ($r.Folder -notmatch '^03 세력/') { Err $c.Rel "관련세력 [[$($lt[0])]]이 03 세력 노트가 아님" }
    $rel += $r.Path
    if (-not $factionCases.ContainsKey($r.Path)) { $factionCases[$r.Path] = @() }
    $factionCases[$r.Path] += $c
  }
  # 가담인물: 그 사건에 있었지만 관련인물에 넣지 않은 사람 (조직 주체 사건). 일지 표 칸에는 들어가지 않는다
  foreach ($t in (ListOf $fm '가담인물')) {
    $lt = LinkTargets $t
    if ($lt.Count -eq 0) { Err $c.Rel "가담인물 항목이 링크가 아님: $t"; continue }
    $r = Resolve $lt[0]
    if (-not $r) { Err $c.Rel "가담인물 [[$($lt[0])]] 노트 없음"; continue }
    if ($r.Folder -ne "02 인물") { Err $c.Rel "가담인물 [[$($lt[0])]]이 02 인물 노트가 아님"; continue }
    if ($relPeople -contains $r.Path) { Err $c.Rel "[[$($lt[0])]]이 관련인물과 가담인물에 모두 있음" }
    else { $relPeople += $r.Path }
    if (-not (LinksTo $c $r)) { Warn $c.Rel "가담인물 [[$($lt[0])]]이 본문에 링크되어 있지 않음" }
  }
  if ((ListOf $fm '가담인물').Count -gt 0 -and (ListOf $fm '관련세력').Count -eq 0) {
    Warn $c.Rel "가담인물이 있는데 관련세력이 비었음 (조직이 주체인 사건인지 확인)"
  }
  $src = Scalar $fm '입수경로'
  $srcLinks = LinkTargets $src
  if ($src -ne "" -and $src -ne "직접" -and $srcLinks.Count -eq 0) { Warn $c.Rel "입수경로가 '직접'도 링크도 아님: '$src'" }
  foreach ($t in $srcLinks) {
    $r = Resolve $t
    if ($r -and $r.Folder -eq "02 인물" -and (Norm $src) -eq (Norm "[[${t}]]")) { $relPeople += $r.Path }  # 직접 들은 사람도 만남
    if ($r -and $r.Folder -eq "02 인물" -and (Norm $src) -ne (Norm "[[${t}]]") -and (Norm $src) -notmatch '^\[\[') {
      # "SNS ([[자료|작성자]])" 꼴이면 자료 노트여야 한다
      Warn $c.Rel "입수경로가 매체 형식인데 인물 노트를 가리킴: '$src'"
    }
  }
  foreach ($p in ($relPeople | Select-Object -Unique)) {
    if (-not $meetings.ContainsKey($p)) { $meetings[$p] = @() }
    $meetings[$p] += [pscustomobject]@{ Day = $dn; Case = $c }
  }
  if ((Scalar $fm '기사화') -eq "true") {
    $linked = $false
    foreach ($a in ($notes | Where-Object { $_.Folder -eq "05 취재·기사" -and (Scalar $_.Front 'type') -eq "기사" })) { if (LinksTo $a $c) { $linked = $true } }
    if (-not $linked) { Warn $c.Rel "기사화: true 인데 이 사건을 링크한 기사 노트가 없음" }
  }
  # 일지 표 행
  if (-not $days.ContainsKey($dn)) { Err $c.Rel "${dn}일차 일지가 없음"; continue }
  $rows = @($days[$dn].Rows | Where-Object { $_.Target.Path -eq $c.Path })
  $dayRel = $days[$dn].Note.Rel
  if ($rows.Count -eq 0) { Err $dayRel "사건 '$($c.Name)'의 행이 없음"; continue }
  if ($rows.Count -gt 1) { Err $dayRel "사건 '$($c.Name)'의 행이 $($rows.Count)개" }
  $row = $rows[0]
  $wantKind = "daily"; if ($gradeSpan.ContainsKey($grade)) { switch ($gradeSpan[$grade]) { "bn-lv-news" { $wantKind = "news" } "bn-lv-scoop" { $wantKind = "scoop" } } }
  if ($row.Kind -ne $wantKind) { Err $dayRel "'$($c.Name)' 행의 등급 이름표가 취재가치($grade)와 다름" }
  if ($row.Time -ne (Scalar $fm '시간')) { Err $dayRel "'$($c.Name)' 행의 시간($($row.Time))이 노트($(Scalar $fm '시간'))와 다름" }
  if ($row.Summary -ne (Norm (Scalar $fm '요약'))) { Err $dayRel "'$($c.Name)' 행의 요약이 노트와 다름`n    표: $($row.Summary)`n    노트: $(Norm (Scalar $fm '요약'))" }
  if (($row.Related -join '|') -ne ($rel -join '|')) { Err $dayRel "'$($c.Name)' 행의 관련 인물 칸이 노트의 관련인물+관련세력과 다름`n    표: $($row.Related -join ', ')`n    노트: $($rel -join ', ')" }
  if ($row.Source -ne (Norm $src)) { Err $dayRel "'$($c.Name)' 행의 입수 경로('$($row.Source)')가 노트('$(Norm $src)')와 다름" }
}
# 표 행 → 노트: 사건 행은 같은 일차 폴더의 사건 노트, 📅 행은 이벤트 노트
foreach ($dn in $days.Keys) {
  foreach ($r in $days[$dn].Rows) {
    $t = $r.Target
    if ($r.Kind -eq "event") {
      if ($t.Folder -ne "01 일지/이벤트") { Err $days[$dn].Note.Rel "📅 행이 이벤트 노트가 아닌 '$($t.Name)'을 가리킴" }
      elseif ((Scalar $t.Front '첫단서') -ne "$dn") { Err $days[$dn].Note.Rel "📅 행 '$($t.Name)'의 첫단서($(Scalar $t.Front '첫단서'))가 이 일차($dn)와 다름" }
    } elseif ($t.Folder -ne "01 일지/사건/${dn}일차") {
      if ($t.Folder -eq "01 일지/이벤트") { Err $days[$dn].Note.Rel "이벤트 '$($t.Name)' 행에 📅 이름표(bn-lv-event)가 없음" }
      else { Err $days[$dn].Note.Rel "행이 ${dn}일차 사건 노트가 아닌 '$($t.Rel)'을 가리킴" }
    }
  }
}
# 이벤트 노트 → 첫단서 일차 표에 📅 행
foreach ($e in $eventNotes) {
  $fd = Scalar $e.Front '첫단서'
  if ($fd -notmatch '^\d+$') { Warn $e.Rel "첫단서가 비었거나 숫자가 아님: '$fd'"; continue }
  if (-not $days.ContainsKey([int]$fd)) { Err $e.Rel "첫단서 ${fd}일차 일지가 없음"; continue }
  $hit = @($days[[int]$fd].Rows | Where-Object { $_.Kind -eq "event" -and $_.Target.Path -eq $e.Path })
  if ($hit.Count -eq 0) { Err $days[[int]$fd].Note.Rel "이벤트 '$($e.Name)'의 📅 행이 없음" }
  foreach ($k in @('관련인물', '관련세력')) {
    foreach ($t in (ListOf $e.Front $k)) { $lt = LinkTargets $t; if ($lt.Count -eq 0 -or -not (Resolve $lt[0])) { Err $e.Rel "$k [[${t}]] 노트 없음" } }
  }
}

# ── 4. 인물 ──
$peopleList = $byPath["02 인물/인물 목록"]
if (-not $peopleList) { Err "02 인물/인물 목록.md" "없음" }
$factionByNorm = @{}
foreach ($f in $factions) { $factionByNorm[(NormName $f.Name)] = $f }
$classTags = @("시민", "기관", "갱")
$orgOf = @{}
foreach ($p in $people) {
  $fm = $p.Front; $tags = ListOf $fm 'tags'
  $numbered = $p.Name -match '^(\d{3}) (.+)$'
  if ($numbered) {
    $num = $matches[1]; $nm = $matches[2]
    # 이름을 모르는 인물(미상 - …)은 aliases를 비워 둬도 된다
    if ($nm -notlike "미상 -*" -and (ListOf $fm 'aliases') -notcontains $nm) { Err $p.Rel "aliases에 번호를 뺀 이름 '$nm' 없음" }
    if ($num -ne "000" -and $tags -notcontains "인물") { Err $p.Rel "tags에 인물 없음" }
    if ($num -eq "000" -and $tags -contains "인물") { Err $p.Rel "나희정 노트에는 인물 태그를 달지 않음" }
  } else {
    if ((ListOf $fm 'aliases') -notcontains $p.Name) { Warn $p.Rel "aliases에 이름 '$($p.Name)' 없음" }
  }
  $cls = @($tags | Where-Object { $classTags -contains $_ })
  if ($cls.Count -ne 1) { Err $p.Rel "분류 태그(시민·기관·갱)가 정확히 하나여야 함: $($cls -join ', ')" }
  foreach ($t in $tags) {
    # 인물·분류 태그와 테스트 표시 태그는 조직 태그가 아니다
    if ($t -eq "인물" -or $t -eq "테스트" -or $classTags -contains $t) { continue }
    if ($factionByNorm.ContainsKey((NormName $t))) { $orgOf[$p.Path] = $factionByNorm[(NormName $t)].Path }
    else { Warn $p.Rel "조직 태그 '$t'에 맞는 세력 노트가 없음 (소속 점선이 그려지지 않음)" }
  }
  $rv = Scalar $fm '관계'; if ($rv -ne "" -and @("동료", "우호", "취재원", "중립", "경계", "적대", "미정") -notcontains $rv) { Warn $p.Rel "관계 값이 목록에 없음: '$rv'" }
  # 나희정 본인(000)은 만난 인물이 아니므로 인물 목록에 없어도 된다
  if ($peopleList -and -not ($numbered -and $num -eq "000") -and -not (LinksTo $peopleList $p)) {
    if ($numbered) { Err $peopleList.Rel "'$($p.Name)' 링크 없음" } else { Warn $peopleList.Rel "'$($p.Name)' 링크 없음 (아직 만나지 않은 인물 표)" }
  }
  if ($meetings.ContainsKey($p.Path)) {
    $ds = @($meetings[$p.Path] | ForEach-Object { $_.Day })
    $min = ($ds | Measure-Object -Minimum).Minimum; $max = ($ds | Measure-Object -Maximum).Maximum
    if ($numbered -and $num -ne "000") {
      if ((Scalar $fm '첫만남') -ne "$min") { Warn $p.Rel "첫만남($(Scalar $fm '첫만남'))이 사건 기록상 첫 일차($min)와 다름" }
      if ((Scalar $fm '최근만남') -ne "$max") { Warn $p.Rel "최근만남($(Scalar $fm '최근만남'))이 사건 기록상 마지막 일차($max)와 다름" }
      foreach ($mt in $meetings[$p.Path]) { if (-not (LinksTo $p $mt.Case)) { Warn $p.Rel "만남 기록에 '$($mt.Case.Name)' 링크 없음" } }
    }
    if (-not $numbered) { Warn $p.Rel "사건에 등장했는데 아직 번호가 없음 (처음 만난 날 번호를 붙인다)" }
  }
}

# ── 5. 세력 ──
$factionList = $byPath["03 세력/세력 목록"]
if (-not $factionList) { Err "03 세력/세력 목록.md" "없음" }
$relRe = [regex]'^(동맹|협력|경쟁|적대)/(.+)$'
foreach ($f in $factions) {
  $fm = $f.Front; $tags = ListOf $fm 'tags'
  $sub = $f.Folder.Substring($f.Folder.LastIndexOf('/') + 1)
  if ((Scalar $fm '분류') -ne $sub) { Err $f.Rel "분류('$(Scalar $fm '분류')')가 폴더($sub)와 다름" }
  foreach ($t in $tags) {
    if ($classTags -contains $t) { Err $f.Rel "세력 노트에는 $t 태그를 달지 않음 (그래프 색용 인물 분류 태그)" }
    $rm = $relRe.Match($t)
    if (-not $rm.Success) { continue }
    $other = $null; if ($factionByNorm.ContainsKey((NormName $rm.Groups[2].Value))) { $other = $factionByNorm[(NormName $rm.Groups[2].Value)] }
    if (-not $other) { Err $f.Rel "관계 태그 '$t'의 상대 세력 노트가 없음"; continue }
    $back = "$($rm.Groups[1].Value)/$(NormName $f.Name)"
    if ((ListOf $other.Front 'tags') -notcontains $back) { Err $other.Rel "'$($f.Name)'이 $t 로 가리키는데 여기에 $back 태그가 없음 (양쪽 모두 적는다)" }
  }
  if ($factionList -and -not (LinksTo $factionList $f)) { Warn $factionList.Rel "'$($f.Name)' 링크 없음" }
  foreach ($pp in $orgOf.Keys) { if ($orgOf[$pp] -eq $f.Path -and -not (LinksTo $f $byPath[$pp])) { Warn $f.Rel "알려진 인원에 소속 인물 '$($byPath[$pp].Name)' 링크 없음" } }
  if ($factionCases.ContainsKey($f.Path)) { foreach ($c in $factionCases[$f.Path]) { if (-not (LinksTo $f $c)) { Warn $f.Rel "관련 사건에 '$($c.Name)' 링크 없음" } } }
}

# ── 6. 취재·기사 목록 ──
$articleList = $byPath["05 취재·기사/기사 목록"]
foreach ($a in ($notes | Where-Object { $_.Folder -match '^05 취재·기사' -and $_.Name -ne "기사 목록" })) {
  if ($articleList -and -not (LinksTo $articleList $a)) { Warn $articleList.Rel "'$($a.Name)' 링크 없음" }
}

# ── 결과 ──
foreach ($e in $script:Errors) { Write-Output $e }
foreach ($w in $script:Warnings) { Write-Output $w }
Write-Output ("검사 끝: 노트 {0}개, 일지 {1}개, 사건 {2}개, 인물 {3}명, 세력 {4}개 — 오류 {5}, 경고 {6}" -f $notes.Count, $days.Count, @($caseNotes).Count, @($people).Count, @($factions).Count, $script:Errors.Count, $script:Warnings.Count)
# 테스트 태그가 붙은 노트 (테스트가 끝나면 지울 것들)
$testNotes = @($notes | Where-Object { (ListOf $_.Front 'tags') -contains "테스트" })
if ($testNotes.Count -gt 0) {
  Write-Output ("테스트 노트 {0}개 (테스트가 끝나면 지운다):" -f $testNotes.Count)
  foreach ($t in ($testNotes | Sort-Object Rel)) { Write-Output ("  " + $t.Rel) }
}
if ($script:Errors.Count -gt 0) { exit 1 }
exit 0
