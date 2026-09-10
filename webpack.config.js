const HtmlWebpackPlugin = require('html-webpack-plugin');
const ModuleFederationPlugin = require('webpack/lib/container/ModuleFederationPlugin');
const webpack = require('webpack');
const path = require('path');
const {
  SubresourceIntegrityPlugin,
} = require('webpack-subresource-integrity');

// Single source of truth for the Module Federation container name. Used as the
// ModuleFederationPlugin `name` AND injected via DefinePlugin as `__MF_NAME__`,
// so App.tsx passes it to useRemoteApp without retyping the string. The host's
// registered-app row's `webpack_module` must match this exactly; the platform
// derives the kebab-case app id from it (horizonPokemon -> horizon-pokemon).
const MODULE_FEDERATION_NAME = 'horizonPokemon';

module.exports = (_env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    mode: argv.mode || 'development',
    // REQUIRED. The extension verifier hard-rejects a bundle with no usable
    // source map (`missing-source-map`, a severity that cannot be relaxed):
    // without one it cannot attribute a finding to a file. Must be a real
    // 'source-map' carrying sourcesContent — an eval- or nosources- variant
    // does not satisfy it, and dist/*.map must ship alongside the JS.
    devtool: 'source-map',
    entry: './src/App.tsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      publicPath: isProduction ? 'auto' : 'http://localhost:5008/',
      filename: isProduction ? '[name].[contenthash].js' : '[name].js',
      chunkFilename: isProduction ? '[id].[contenthash].js' : '[id].js',
      // Required by SubresourceIntegrityPlugin: the runtime must request chunks
      // in CORS mode for the browser to check their integrity values.
      crossOriginLoading: 'anonymous',
      clean: true,
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.jsx'],
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                '@babel/preset-env',
                ['@babel/preset-react', { runtime: 'automatic' }],
                '@babel/preset-typescript',
              ],
            },
          },
        },
      ],
    },
    plugins: [
      new ModuleFederationPlugin({
        name: MODULE_FEDERATION_NAME,
        filename: 'remoteEntry.js',
        exposes: {
          './App': './src/App',
        },
        // Host-provided singletons only.
        shared: {
          react: { singleton: true, requiredVersion: '^19.2.0', eager: false },
          'react-dom': {
            singleton: true,
            requiredVersion: '^19.2.0',
            eager: false,
          },
          loglevel: { singleton: true, requiredVersion: '^1.9.2', eager: false },
          // '@netsapiens/horizon-sdk' is intentionally NOT shared: the host registers
          // react, react-dom, loglevel and i18next and nothing else, so declaring the
          // SDK shared cannot resolve to a host copy. Its provide/consume pair also
          // puts a cycle in the chunk graph that leaves the SRI plugin's integrity
          // placeholders unresolved, failing the build — and the verifier rejects on
          // `sdk-not-shared`. `import: false` is not a workaround.
          //
          // MUI is intentionally NOT shared either — consume it via horizonContext.ui
          // so the page inherits the host theme.
        },
      }),
      // The Horizon extension verifier hard-rejects a remoteEntry.js that
      // carries no per-chunk integrity values (`no-chunk-integrity`): pinning the
      // loader alone would not cover the code it loads. This plugin emits the
      // `sriHashes` runtime map the verifier requires and the browser enforces.
      // Production only — it is incompatible with the dev server's HMR chunks.
      ...(isProduction
        ? [new SubresourceIntegrityPlugin({ hashFuncNames: ['sha384'] })]
        : []),
      new webpack.DefinePlugin({
        __MF_NAME__: JSON.stringify(MODULE_FEDERATION_NAME),
      }),
      new HtmlWebpackPlugin({
        template: './index.html',
      }),
    ],
    devServer: {
      port: 5008,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    },
  };
};
