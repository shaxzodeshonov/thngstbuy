const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const repoRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

/**
 * The list rules, money formatting and Item shape live in ../src/domain and are
 * shared verbatim with the web app. They are pure TypeScript with no imports of
 * their own, so Metro only needs to be told the folder exists and given a name
 * to resolve it under.
 */
config.watchFolders = [path.resolve(repoRoot, 'src/domain')]

config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]
config.resolver.extraNodeModules = {
  '@domain': path.resolve(repoRoot, 'src/domain'),
}

module.exports = config
