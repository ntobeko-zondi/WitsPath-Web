# Builds and tests the WitsPath routing engine with plain JDK tools (JDK 11+).
#   ./routing/build.ps1          build + test
# Output:
#   routing/build/witspath-routing.jar       routing service (java -jar)
#   routing/build/witspath-routing-core.jar  engine only - for the Android app
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$build = Join-Path $root 'build'
if (Test-Path $build) { Remove-Item -Recurse -Force $build }
New-Item -ItemType Directory -Force "$build/core", "$build/service", "$build/test" | Out-Null

function Sources($dir) { Get-ChildItem -Recurse -Filter *.java (Join-Path $root $dir) | ForEach-Object { $_.FullName } }

# --release 11 keeps the engine usable from the Android app's toolchain.
javac --release 11 -encoding UTF-8 -d "$build/core" (Sources 'core/src/main/java')
if ($LASTEXITCODE) { throw 'core compile failed' }
javac --release 11 -encoding UTF-8 -cp "$build/core" -d "$build/service" (Sources 'service/src/main/java')
if ($LASTEXITCODE) { throw 'service compile failed' }
$sep = [IO.Path]::PathSeparator
javac --release 11 -encoding UTF-8 -cp "$build/core$sep$build/service" -d "$build/test" (Sources 'test')
if ($LASTEXITCODE) { throw 'test compile failed' }

$graph = Join-Path $root '../public/data/wits-west-map.json'
java -cp "$build/core$sep$build/service$sep$build/test" com.example.witspath.routing.service.RoutingTests $graph
if ($LASTEXITCODE) { throw 'routing tests failed' }

jar --create --file "$build/witspath-routing-core.jar" -C "$build/core" .
jar --create --file "$build/witspath-routing.jar" --main-class com.example.witspath.routing.service.RoutingServer -C "$build/core" . -C "$build/service" .
Write-Host "Built $build/witspath-routing.jar and $build/witspath-routing-core.jar"
