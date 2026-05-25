const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Zustand v5's ESM builds (esm/*.mjs) contain `import.meta` which Metro's
// web bundler cannot handle. Force all `zustand/*` imports to the CJS builds.
const zustandRoot = path.dirname(require.resolve('zustand/package.json'));

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'zustand' || moduleName.startsWith('zustand/')) {
    const subpath = moduleName === 'zustand'
      ? 'index'
      : moduleName.slice('zustand/'.length);
    return { type: 'sourceFile', filePath: path.join(zustandRoot, `${subpath}.js`) };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
