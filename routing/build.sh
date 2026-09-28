#!/usr/bin/env sh
# Builds and tests the WitsPath routing engine with plain JDK tools (JDK 11+).
#   ./routing/build.sh          build + test
# Output:
#   routing/build/witspath-routing.jar       routing service (java -jar)
#   routing/build/witspath-routing-core.jar  engine only - for the Android app
set -eu
root=$(cd "$(dirname "$0")" && pwd)
build="$root/build"
rm -rf "$build"
mkdir -p "$build/core" "$build/service" "$build/test"

# --release 11 keeps the engine usable from the Android app's toolchain.
javac --release 11 -encoding UTF-8 -d "$build/core" $(find "$root/core/src/main/java" -name '*.java')
javac --release 11 -encoding UTF-8 -cp "$build/core" -d "$build/service" $(find "$root/service/src/main/java" -name '*.java')
javac --release 11 -encoding UTF-8 -cp "$build/core:$build/service" -d "$build/test" $(find "$root/test" -name '*.java')

java -cp "$build/core:$build/service:$build/test" com.example.witspath.routing.service.RoutingTests \
  "$root/../public/data/wits-west-map.json"

jar --create --file "$build/witspath-routing-core.jar" -C "$build/core" .
jar --create --file "$build/witspath-routing.jar" --main-class com.example.witspath.routing.service.RoutingServer -C "$build/core" . -C "$build/service" .
echo "Built $build/witspath-routing.jar and $build/witspath-routing-core.jar"
