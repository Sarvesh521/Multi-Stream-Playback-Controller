// webpack.config.js (in your Chrome Extension project)
const path = require('path');
const Dotenv = require('dotenv-webpack');
module.exports = {
  mode: 'production',
  entry: {
    background: './src/background.js',
    content: './src/content.js',
    'webapp-content-script': './src/webapp-content-script.js' 
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].bundle.js',
  },
  plugins: [
    new Dotenv ()
  ],
};