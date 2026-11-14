script_phase(
  :name => 'Build AmneziaWG Go backend',
  :execution_position => :before_compile,
  :script => <<-'SCRIPT'
set -euo pipefail

PACKAGE_ROOT="${BUILD_DIR}/../../SourcePackages/checkouts/amneziawg-apple"
GO_BRIDGE="${PACKAGE_ROOT}/Sources/WireGuardKitGo"
if [ ! -f "${GO_BRIDGE}/Makefile" ]; then
  echo "error: AmneziaWG WireGuardKit Go bridge was not checked out at ${GO_BRIDGE}."
  exit 1
fi
if ! command -v go >/dev/null 2>&1; then
  echo "error: Go is required to build the AmneziaWG iOS backend. Install Go, then rebuild."
  exit 1
fi

make -C "${GO_BRIDGE}" build \
  ARCHS="${ARCHS}" \
  PLATFORM_NAME="iphoneos" \
  SDKROOT="${SDKROOT}" \
  CONFIGURATION_BUILD_DIR="${GO_BRIDGE}/out" \
  CONFIGURATION_TEMP_DIR="${DERIVED_FILE_DIR}/amneziawg-go"
SCRIPT
)
