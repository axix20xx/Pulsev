const { withXcodeProjectBeta } = require("@bacons/apple-targets/build/with-bacons-xcode");
const {
  PBXBuildFile,
  PBXShellScriptBuildPhase,
  XCRemoteSwiftPackageReference,
  XCSwiftPackageProductDependency,
} = require("@bacons/xcode");

const PACKAGES = [
  {
    repositoryURL: "https://github.com/amnezia-vpn/amneziawg-apple.git",
    version: "3.1.5",
    productName: "WireGuardKit",
  },
  {
    repositoryURL: "https://github.com/ss-abramchuk/OpenVPNAdapter.git",
    version: "0.8.0",
    productName: "OpenVPNAdapter",
  },
];

module.exports = function withPulseVpnPackages(config) {
  return withXcodeProjectBeta(config, (config) => {
    const project = config.modResults;
    const target = project.rootObject.props.targets.find(
      (candidate) => candidate.props.name === "PulsePacketTunnel",
    );
    if (!target) {
      throw new Error(
        "PulsePacketTunnel target is missing. Keep the @bacons/apple-targets plugin before this plugin.",
      );
    }

    const mainTarget = project.rootObject.props.targets.find(
      (candidate) =>
        candidate.props.productType === "com.apple.product-type.application" &&
        candidate.props.name !== "PulsePacketTunnel",
    );
    if (!mainTarget) {
      throw new Error("The iOS application target is missing.");
    }

    for (const buildTarget of [mainTarget, target]) {
      for (const configuration of buildTarget.props.buildConfigurationList.props.buildConfigurations) {
        configuration.props.buildSettings.INFOPLIST_KEY_PulseKeychainAccessGroup =
          "$(AppIdentifierPrefix)com.pulse.vpnclient.shared";
      }
    }

    const goLibrarySearchPath =
      "$(BUILD_DIR)/../../SourcePackages/checkouts/amneziawg-apple/Sources/WireGuardKitGo/out";
    for (const configuration of target.props.buildConfigurationList.props.buildConfigurations) {
      const current = configuration.props.buildSettings.LIBRARY_SEARCH_PATHS;
      const values = Array.isArray(current) ? current : current ? [current] : [];
      const normalized = values.map((value) =>
        String(value).replace(/^[\\"']+|[\\"']+$/g, ""),
      );
      if (!normalized.includes("$(inherited)")) normalized.unshift("$(inherited)");
      if (!normalized.includes(goLibrarySearchPath)) normalized.push(goLibrarySearchPath);
      configuration.props.buildSettings.LIBRARY_SEARCH_PATHS = normalized;
    }

    project.rootObject.props.packageReferences ??= [];
    target.props.packageProductDependencies ??= [];
    const frameworkPhase = target.getFrameworksBuildPhase();
    target.ensureFrameworks(["UIKit.framework"]);

    const goBuildPhaseName = "Build AmneziaWG Go backend without Xray";
    let goBuildPhase = target.props.buildPhases.find(
      (phase) => PBXShellScriptBuildPhase.is(phase) && phase.props.name === goBuildPhaseName,
    );
    if (!goBuildPhase) {
      goBuildPhase = target.createBuildPhase(PBXShellScriptBuildPhase, {
        name: goBuildPhaseName,
        shellPath: "/bin/bash",
        shellScript: [
          "set -euo pipefail",
          'PACKAGE_ROOT="${BUILD_DIR}/../../SourcePackages/checkouts/amneziawg-apple"',
          'GO_BRIDGE="${PACKAGE_ROOT}/Sources/WireGuardKitGo"',
          'BUILD_SOURCE="${DERIVED_FILE_DIR}/amneziawg-go-source"',
          'if [ ! -f "${GO_BRIDGE}/Makefile" ]; then',
          '  echo "error: AmneziaWG WireGuardKit Go sources were not checked out."',
          "  exit 1",
          "fi",
          'if ! command -v go >/dev/null 2>&1; then',
          '  echo "error: Go 1.26 or newer is required to build the AmneziaWG iOS engine."',
          "  exit 1",
          "fi",
          'rm -rf "${BUILD_SOURCE}"',
          'mkdir -p "${BUILD_SOURCE}"',
          'rsync -a --exclude "api-xray.go" "${GO_BRIDGE}/" "${BUILD_SOURCE}/"',
          'chmod -R u+w "${BUILD_SOURCE}"',
          'python3 "${PROJECT_DIR}/../scripts/prepare-amneziawg-go-patch.py" "$(go env GOROOT)" "${BUILD_SOURCE}"',
          '(cd "${BUILD_SOURCE}" && go mod tidy)',
          'GO_PLATFORM="${PLATFORM_NAME}"',
          'if [ "${PLATFORM_NAME}" = "iphonesimulator" ]; then GO_PLATFORM="iphoneos"; fi',
          'make -C "${BUILD_SOURCE}" build \\',
          '  ARCHS="${ARCHS}" \\',
          '  PLATFORM_NAME="${GO_PLATFORM}" \\',
          '  SDKROOT="${SDKROOT}" \\',
          '  CONFIGURATION_BUILD_DIR="${GO_BRIDGE}/out" \\',
          '  CONFIGURATION_TEMP_DIR="${DERIVED_FILE_DIR}/amneziawg-go"',
        ].join("\n"),
      });
      target.props.buildPhases.splice(target.props.buildPhases.indexOf(goBuildPhase), 1);
      const frameworkIndex = target.props.buildPhases.indexOf(frameworkPhase);
      target.props.buildPhases.splice(frameworkIndex, 0, goBuildPhase);
    } else {
      const currentIndex = target.props.buildPhases.indexOf(goBuildPhase);
      if (currentIndex !== -1) target.props.buildPhases.splice(currentIndex, 1);
      const frameworkIndex = target.props.buildPhases.indexOf(frameworkPhase);
      target.props.buildPhases.splice(frameworkIndex, 0, goBuildPhase);
    }

    for (const item of PACKAGES) {
      let packageReference = project.rootObject.props.packageReferences.find(
        (reference) => reference.props.repositoryURL === item.repositoryURL,
      );
      if (!packageReference) {
        packageReference = XCRemoteSwiftPackageReference.create(project, {
          repositoryURL: item.repositoryURL,
          requirement: {
            kind: "exactVersion",
            version: item.version,
          },
        });
        project.rootObject.props.packageReferences.push(packageReference);
      }

      let product = target.props.packageProductDependencies.find(
        (dependency) => dependency.props.productName === item.productName,
      );
      if (!product) {
        product = XCSwiftPackageProductDependency.create(project, {
          package: packageReference,
          productName: item.productName,
        });
        target.props.packageProductDependencies.push(product);
        const buildFile = PBXBuildFile.create(project, { productRef: product });
        frameworkPhase.props.files.push(buildFile);
      }
    }

    return config;
  });
};
