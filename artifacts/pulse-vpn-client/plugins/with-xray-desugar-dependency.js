const { withAppBuildGradle } = require("expo/config-plugins");

const marker = "// Ensure Xray AAR extraction completes before app desugar tasks.";

module.exports = function withXrayDesugarDependency(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error("The Xray Gradle dependency plugin expects Groovy app/build.gradle.");
    }

    const contents = config.modResults.contents;
    if (contents.includes(marker)) {
      return config;
    }

    config.modResults.contents =
      `${contents.trimEnd()}\n\n${marker}\n` +
      'tasks.matching { it.name.startsWith("desugar") && it.name.endsWith("FileDependencies") }.configureEach {\n' +
      '    dependsOn(":expo-xray-vpn:extractXrayAar")\n' +
      "}\n";

    return config;
  });
};
