// Expo's Flow strip-types plugin runs on every file, including generated
// Spacetime bindings that use TypeScript `declare` class fields.
module.exports = function (api) {
  api.cache(true);
  const flowStripTypes = require.resolve("@babel/plugin-transform-flow-strip-types", {
    paths: [require.resolve("babel-preset-expo")],
  });
  return {
    presets: ["babel-preset-expo"],
    overrides: [
      {
        plugins: [[flowStripTypes, { allowDeclareFields: true }]],
      },
    ],
  };
};
