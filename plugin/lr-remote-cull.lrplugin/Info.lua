return {
  LrSdkVersion = 13.0,
  LrSdkMinimumVersion = 10.0,
  LrToolkitIdentifier = 'dev.chrisye.lrremotecull',
  LrPluginName = 'LR Remote Cull',
  LrInitPlugin = 'Init.lua',
  LrForceInitPlugin = true,
  LrShutdownPlugin = 'Shutdown.lua',
  LrLibraryMenuItems = {
    { title = 'Remote Cull: start bridge', file = 'StartBridge.lua' },
  },
  VERSION = { major = 0, minor = 1, revision = 0 },
}
