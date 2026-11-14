const { withXcodeProjectBeta } = require("@bacons/apple-targets/build/with-bacons-xcode");
const {
  PBXBuildFile,
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

    project.rootObject.props.packageReferences ??= [];
    target.props.packageProductDependencies ??= [];
    const frameworkPhase = target.getFrameworksBuildPhase();

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
