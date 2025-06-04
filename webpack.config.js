// webpack.config.js
const path = require('path');

module.exports = {
  mode: 'development', // Change to 'production' for final builds
  entry: {
    background: './background.js',
    content: './content.js',
    popup: './popup.js'
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  devtool: 'cheap-module-source-map', // Good for debugging
  resolve: {
    fallback: {
        "buffer": require.resolve("buffer/"),
        "crypto": require.resolve("crypto-browserify"),
        "stream": require.resolve("stream-browserify"),
        "util": require.resolve("util/"),
        "vm": require.resolve("vm-browserify")
    }
  },
  module: {
    rules: [
      // You can add babel-loader here if needed for older JS syntax
    ]
  }
};